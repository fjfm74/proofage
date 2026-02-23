import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Prisma, PrismaClient, type ProofRequest } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const loadDotEnv = () => {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env")
  ];

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

loadDotEnv();
if (!process.env.PROOFAGE_DATABASE_URL) {
  process.env.PROOFAGE_DATABASE_URL = "file:./dev.db";
}

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const port = Number(process.env.PORT ?? 8787);
const verifierCallbackSecret = process.env.VERIFIER_CALLBACK_SECRET ?? "dev_verifier_secret_change_me";
const jwtSigningKey = process.env.JWT_SIGNING_KEY ?? "dev_jwt_signing_key_change_me_and_make_it_long";
const assertionTtlSeconds = Number(process.env.ASSERTION_TTL_SECONDS ?? 600);

type MerchantContext = {
  merchantId: string;
  merchantExternalRef: string;
};

const requestSchema = z.object({
  subjectRef: z.string().min(3),
  minAge: z.number().int().min(13).max(25).default(18)
});

const callbackSchema = z.object({
  proofRequestId: z.string().uuid(),
  result: z.enum(["passed", "failed"]),
  verifierRef: z.string().min(1)
});

const proofRequestParamsSchema = z.object({
  proofRequestId: z.string().uuid()
});

const merchantApiKeyCreateSchema = z.object({
  label: z.string().min(2).max(64).default("manual")
});

const merchantApiKeyListQuerySchema = z.object({
  includeRevoked: z.coerce.boolean().optional().default(false)
});

const merchantApiKeyParamsSchema = z.object({
  apiKeyId: z.string().cuid()
});

const proofAssertionQuerySchema = z.object({
  nonce: z.string().min(8).max(200).optional()
});

const verifyAssertionSchema = z.object({
  assertion: z.string().min(20),
  requiredMinAge: z.number().int().min(13).max(25).default(18),
  expectedNonce: z.string().min(8).max(200),
  expectedSubjectRef: z.string().min(3).optional()
});

const assertionPayloadSchema = z.object({
  age_over: z.number().int().min(13).max(25),
  nonce: z.string().min(8).max(200),
  proof_request_id: z.string().uuid().optional(),
  verifier_ref: z.string().optional()
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const buildApiKeyPlaintext = () => `pkr_${randomUUID().replaceAll("-", "")}`;
const buildApiKeyPreview = (value: string) => `${value.slice(0, 8)}...${value.slice(-4)}`;

const readHeader = (request: FastifyRequest, headerName: string): string | null => {
  const value = request.headers[headerName];
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }

  return null;
};

const safeEqual = (a: string, b: string): boolean => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
};

const unauthorized = (reply: FastifyReply, code: string, message: string) =>
  reply.status(401).send({ code, message });

const authenticateMerchant = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<MerchantContext | null> => {
  const apiKey = readHeader(request, "x-api-key");

  if (!apiKey) {
    unauthorized(reply, "MISSING_API_KEY", "x-api-key header is required");
    return null;
  }

  const keyHash = sha256(apiKey);

  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      revokedAt: null
    },
    include: {
      merchant: true
    }
  });

  if (!keyRecord) {
    unauthorized(reply, "INVALID_API_KEY", "API key is invalid or revoked");
    return null;
  }

  await prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date() }
  });

  return {
    merchantId: keyRecord.merchantId,
    merchantExternalRef: keyRecord.merchant.externalRef
  };
};

const verifyCallbackSecret = (request: FastifyRequest, reply: FastifyReply): boolean => {
  const provided = readHeader(request, "x-verifier-secret");

  if (!provided) {
    unauthorized(reply, "MISSING_VERIFIER_SECRET", "x-verifier-secret header is required");
    return false;
  }

  if (!safeEqual(provided, verifierCallbackSecret)) {
    unauthorized(reply, "INVALID_VERIFIER_SECRET", "verifier secret is invalid");
    return false;
  }

  return true;
};

const buildAgeAssertion = async (
  merchantExternalRef: string,
  proof: ProofRequest,
  nonce: string
): Promise<{ token: string; expiresInSeconds: number; nonce: string }> => {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + assertionTtlSeconds;
  const tokenJti = randomUUID();

  const token = await new SignJWT({
    age_over: proof.minAge,
    nonce,
    proof_request_id: proof.id,
    verifier_ref: proof.verifierRef ?? undefined
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("proofage-rail")
    .setAudience(merchantExternalRef)
    .setSubject(proof.subjectRef)
    .setJti(tokenJti)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(jwtSigningKey));

  return {
    token,
    expiresInSeconds: assertionTtlSeconds,
    nonce
  };
};

app.get("/health", async () => ({ status: "ok", service: "proof-api" }));

app.post("/v1/merchant/api-keys", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const parsed = merchantApiKeyCreateSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      code: "INVALID_REQUEST",
      message: "Request body is invalid",
      details: parsed.error.flatten()
    });
  }

  const apiKey = buildApiKeyPlaintext();
  const keyHash = sha256(apiKey);

  const created = await prisma.apiKey.create({
    data: {
      merchantId: merchant.merchantId,
      keyHash,
      label: parsed.data.label,
      preview: buildApiKeyPreview(apiKey)
    }
  });

  return reply.status(201).send({
    apiKeyId: created.id,
    label: created.label,
    preview: created.preview,
    createdAt: created.createdAt.toISOString(),
    apiKey,
    warning: "Save apiKey now. It is shown only once."
  });
});

app.get("/v1/merchant/api-keys", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const parsed = merchantApiKeyListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({
      code: "INVALID_QUERY",
      message: "Query params are invalid",
      details: parsed.error.flatten()
    });
  }

  const items = await prisma.apiKey.findMany({
    where: {
      merchantId: merchant.merchantId,
      ...(parsed.data.includeRevoked ? {} : { revokedAt: null })
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      label: true,
      preview: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true
    }
  });

  return reply.send({
    items: items.map((item) => ({
      apiKeyId: item.id,
      label: item.label,
      preview: item.preview,
      createdAt: item.createdAt.toISOString(),
      lastUsedAt: item.lastUsedAt ? item.lastUsedAt.toISOString() : null,
      revokedAt: item.revokedAt ? item.revokedAt.toISOString() : null
    }))
  });
});

app.post("/v1/merchant/api-keys/:apiKeyId/revoke", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const params = merchantApiKeyParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({
      code: "INVALID_PARAMS",
      message: "apiKeyId is invalid"
    });
  }

  const target = await prisma.apiKey.findFirst({
    where: {
      id: params.data.apiKeyId,
      merchantId: merchant.merchantId
    }
  });

  if (!target) {
    return reply.status(404).send({
      code: "NOT_FOUND",
      message: "apiKeyId not found"
    });
  }

  const currentApiKey = readHeader(request, "x-api-key");
  if (currentApiKey && sha256(currentApiKey) === target.keyHash) {
    return reply.status(409).send({
      code: "CANNOT_REVOKE_CURRENT_KEY",
      message: "Use another active key to revoke this key"
    });
  }

  if (target.revokedAt) {
    return reply.send({ ok: true, alreadyRevoked: true });
  }

  const updated = await prisma.apiKey.update({
    where: { id: target.id },
    data: { revokedAt: new Date() }
  });

  return reply.send({
    ok: true,
    apiKeyId: updated.id,
    revokedAt: updated.revokedAt?.toISOString() ?? null
  });
});

app.post("/v1/proof/request", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      code: "INVALID_REQUEST",
      message: "Request body is invalid",
      details: parsed.error.flatten()
    });
  }

  const record = await prisma.proofRequest.create({
    data: {
      subjectRef: parsed.data.subjectRef,
      minAge: parsed.data.minAge,
      status: "pending",
      merchantId: merchant.merchantId
    }
  });

  return reply.status(201).send({
    proofRequestId: record.id,
    merchantId: merchant.merchantExternalRef,
    status: record.status,
    verifyUrl: `https://verify.placeholder/proof/${record.id}`
  });
});

app.post("/v1/proof/callback", async (request, reply) => {
  if (!verifyCallbackSecret(request, reply)) {
    return;
  }

  const parsed = callbackSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      code: "INVALID_CALLBACK",
      message: "Callback body is invalid",
      details: parsed.error.flatten()
    });
  }

  const current = await prisma.proofRequest.findUnique({
    where: { id: parsed.data.proofRequestId }
  });

  if (!current) {
    return reply.status(404).send({
      code: "NOT_FOUND",
      message: "proofRequestId not found"
    });
  }

  await prisma.proofRequest.update({
    where: { id: parsed.data.proofRequestId },
    data: {
      status: parsed.data.result,
      verifierRef: parsed.data.verifierRef
    }
  });

  return reply.send({ ok: true });
});

app.get("/v1/proof/status/:proofRequestId", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const params = proofRequestParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({
      code: "INVALID_PARAMS",
      message: "proofRequestId must be a UUID"
    });
  }

  const current = await prisma.proofRequest.findFirst({
    where: {
      id: params.data.proofRequestId,
      merchantId: merchant.merchantId
    }
  });

  if (!current) {
    return reply.status(404).send({
      code: "NOT_FOUND",
      message: "proofRequestId not found"
    });
  }

  return reply.send({
    proofRequestId: current.id,
    status: current.status,
    minAge: current.minAge,
    ageAssertion: current.status === "passed" ? `age_over_${current.minAge}` : null,
    updatedAt: current.updatedAt.toISOString()
  });
});

app.get("/v1/proof/assertion/:proofRequestId", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const params = proofRequestParamsSchema.safeParse(request.params);
  if (!params.success) {
    return reply.status(400).send({
      code: "INVALID_PARAMS",
      message: "proofRequestId must be a UUID"
    });
  }

  const current = await prisma.proofRequest.findFirst({
    where: {
      id: params.data.proofRequestId,
      merchantId: merchant.merchantId
    }
  });

  if (!current) {
    return reply.status(404).send({
      code: "NOT_FOUND",
      message: "proofRequestId not found"
    });
  }

  if (current.status !== "passed") {
    return reply.status(409).send({
      code: "PROOF_NOT_PASSED",
      message: "Age assertion is available only for passed proofs"
    });
  }

  const query = proofAssertionQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply.status(400).send({
      code: "INVALID_QUERY",
      message: "Query params are invalid",
      details: query.error.flatten()
    });
  }

  const nonce = query.data.nonce ?? randomUUID();
  const assertion = await buildAgeAssertion(merchant.merchantExternalRef, current, nonce);

  return reply.send({
    tokenType: "Bearer",
    assertion: assertion.token,
    expiresInSeconds: assertion.expiresInSeconds,
    nonce: assertion.nonce,
    claim: `age_over_${current.minAge}`
  });
});

app.post("/v1/relying/verify-assertion", async (request, reply) => {
  const merchant = await authenticateMerchant(request, reply);
  if (!merchant) {
    return;
  }

  const parsed = verifyAssertionSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      code: "INVALID_REQUEST",
      message: "Request body is invalid",
      details: parsed.error.flatten()
    });
  }

  let verification;
  try {
    verification = await jwtVerify(
      parsed.data.assertion,
      new TextEncoder().encode(jwtSigningKey),
      {
        issuer: "proofage-rail",
        audience: merchant.merchantExternalRef
      }
    );

  } catch {
    return reply.status(401).send({
      code: "INVALID_ASSERTION",
      message: "Assertion is invalid, expired, or not issued for this merchant"
    });
  }

  const payloadParsed = assertionPayloadSchema.safeParse(verification.payload);
  if (!payloadParsed.success) {
    return reply.status(400).send({
      code: "INVALID_ASSERTION_CLAIMS",
      message: "Assertion payload is invalid",
      details: payloadParsed.error.flatten()
    });
  }

  if (payloadParsed.data.nonce !== parsed.data.expectedNonce) {
    return reply.status(409).send({
      code: "NONCE_MISMATCH",
      message: "Assertion nonce does not match expectedNonce"
    });
  }

  if (
    parsed.data.expectedSubjectRef &&
    verification.payload.sub !== parsed.data.expectedSubjectRef
  ) {
    return reply.status(409).send({
      code: "SUBJECT_MISMATCH",
      message: "Assertion subject does not match expectedSubjectRef"
    });
  }

  const tokenJti = verification.payload.jti;
  if (typeof tokenJti !== "string" || tokenJti.length < 8) {
    return reply.status(400).send({
      code: "INVALID_ASSERTION_CLAIMS",
      message: "Assertion jti claim is required"
    });
  }

  const expiresAtDate = typeof verification.payload.exp === "number" ? new Date(verification.payload.exp * 1000) : null;

  try {
    await prisma.assertionUse.create({
      data: {
        tokenJti,
        nonce: payloadParsed.data.nonce,
        subjectRef: typeof verification.payload.sub === "string" ? verification.payload.sub : null,
        merchantId: merchant.merchantId,
        proofRequestId: payloadParsed.data.proof_request_id ?? null,
        expiresAt: expiresAtDate
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reply.status(409).send({
        code: "ASSERTION_REPLAYED",
        message: "Assertion has already been consumed or nonce was already used"
      });
    }

    throw error;
  }

  const expiresAt =
    typeof verification.payload.exp === "number"
      ? new Date(verification.payload.exp * 1000).toISOString()
      : null;

  const issuedAt =
    typeof verification.payload.iat === "number"
      ? new Date(verification.payload.iat * 1000).toISOString()
      : null;

  const meetsMinAge = payloadParsed.data.age_over >= parsed.data.requiredMinAge;

  return reply.send({
    valid: true,
    meetsMinAge,
    requiredMinAge: parsed.data.requiredMinAge,
    assertedAgeOver: payloadParsed.data.age_over,
    nonce: payloadParsed.data.nonce,
    subjectRef: verification.payload.sub ?? null,
    proofRequestId: payloadParsed.data.proof_request_id ?? null,
    verifierRef: payloadParsed.data.verifier_ref ?? null,
    issuer: verification.payload.iss ?? null,
    audience: verification.payload.aud ?? null,
    issuedAt,
    expiresAt
  });
});

const start = async () => {
  try {
    if (jwtSigningKey.length < 32) {
      app.log.warn("JWT_SIGNING_KEY should be at least 32 characters in production");
    }

    if (verifierCallbackSecret.includes("change_me")) {
      app.log.warn("VERIFIER_CALLBACK_SECRET is using a weak default value");
    }

    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`proof-api listening on ${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
