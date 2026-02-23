import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const merchantExternalRef = process.env.BOOTSTRAP_MERCHANT_EXTERNAL_REF ?? "merchant_demo";
const merchantName = process.env.BOOTSTRAP_MERCHANT_NAME ?? "Demo Merchant";
const apiKey = process.env.BOOTSTRAP_API_KEY ?? "proofage_demo_key_change_me";

if (apiKey.length < 16) {
  console.error("BOOTSTRAP_API_KEY must be at least 16 chars.");
  process.exit(1);
}

const keyHash = createHash("sha256").update(apiKey).digest("hex");

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { externalRef: merchantExternalRef },
    update: { name: merchantName },
    create: {
      externalRef: merchantExternalRef,
      name: merchantName
    }
  });

  await prisma.apiKey.upsert({
    where: { keyHash },
    update: {
      label: "bootstrap",
      preview: `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`,
      revokedAt: null,
      merchantId: merchant.id
    },
    create: {
      keyHash,
      label: "bootstrap",
      preview: `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`,
      merchantId: merchant.id
    }
  });

  console.log("Seed complete:");
  console.log(`- merchant externalRef: ${merchant.externalRef}`);
  console.log(`- merchant name: ${merchant.name}`);
  console.log(`- api key (plaintext, keep private): ${apiKey}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
