#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Keypair } = require("@solana/web3.js");
const TOML = require("@iarna/toml");

const PROGRAM_NAME = "btc_relay";

const ENV_TO_KEY = {
  mainnet: "default",
  testnet3: "default",
  testnet4: "testnet4",
};

const CLUSTERS = ["mainnet", "localnet", "devnet"];
const VALID_ENVS = Object.keys(ENV_TO_KEY);

const envName = process.argv[2];
const projectDir = process.cwd();

if (!envName || !VALID_ENVS.includes(envName)) {
  console.error(`Usage: node scripts/build.js <${VALID_ENVS.join("|")}>`);
  process.exit(1);
}

const keysDir = path.join(projectDir, "keys");
const targetDeployDir = path.join(projectDir, "target", "deploy");
const anchorTomlPath = path.join(projectDir, "Anchor.toml");
const targetKeypairPath = path.join(targetDeployDir, `${PROGRAM_NAME}-keypair.json`);

const keyPaths = {
  default: path.join(keysDir, "default.json"),
  testnet4: path.join(keysDir, "testnet4.json"),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function generateKeypairIfMissing(filePath) {
  if (fs.existsSync(filePath)) {
    return;
  }

  const keypair = Keypair.generate();
  const secretKey = Array.from(keypair.secretKey);

  fs.writeFileSync(filePath, JSON.stringify(secretKey, null, 2), {
    mode: 0o600,
    flag: "wx",
  });

  console.log(`Generated keypair: ${path.relative(projectDir, filePath)}`);
  console.log(`Public key: ${keypair.publicKey.toBase58()}`);
}

function loadKeypair(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(raw));

  if (secretKey.length !== 64) {
    throw new Error(`Invalid Solana keypair file: ${filePath}`);
  }

  return Keypair.fromSecretKey(secretKey);
}

function copySelectedKeypair(sourcePath, destPath) {
  ensureDir(path.dirname(destPath));

  fs.copyFileSync(sourcePath, destPath);
  fs.chmodSync(destPath, 0o600);

  console.log(
    `Copied ${path.relative(projectDir, sourcePath)} -> ${path.relative(
      projectDir,
      destPath
    )}`
  );
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(" ")}`);

  execFileSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
  });
}

function updateAnchorToml(programId) {
  if (!fs.existsSync(anchorTomlPath)) {
    throw new Error(`Anchor.toml not found at ${anchorTomlPath}`);
  }

  const raw = fs.readFileSync(anchorTomlPath, "utf8");
  const config = TOML.parse(raw);

  if (!config.programs) {
    config.programs = {};
  }

  for (const cluster of CLUSTERS) {
    if (!config.programs[cluster]) {
      config.programs[cluster] = {};
    }

    config.programs[cluster][PROGRAM_NAME] = programId;
  }

  const stringified = TOML.stringify(config);
  fs.writeFileSync(anchorTomlPath, stringified);

  console.log("\nUpdated Anchor.toml program IDs:");
  for (const cluster of CLUSTERS) {
    console.log(`  [programs.${cluster}] ${PROGRAM_NAME} = "${programId}"`);
  }
}

function main() {
  ensureDir(keysDir);
  ensureDir(targetDeployDir);

  generateKeypairIfMissing(keyPaths.default);
  generateKeypairIfMissing(keyPaths.testnet4);

  const selectedKeyName = ENV_TO_KEY[envName];
  const selectedKeyPath = keyPaths[selectedKeyName];
  const selectedKeypair = loadKeypair(selectedKeyPath);
  const selectedProgramId = selectedKeypair.publicKey.toBase58();

  console.log(`\nEnvironment: ${envName}`);
  console.log(`Selected key: ${selectedKeyName}`);
  console.log(`Selected program ID: ${selectedProgramId}`);

  copySelectedKeypair(selectedKeyPath, targetKeypairPath);

  fs.copyFileSync("Anchor.toml", "_Anchor.toml");

  run("anchor", ["keys", "sync", "--program-name", PROGRAM_NAME]);

  fs.copyFileSync("_Anchor.toml", "Anchor.toml");
  fs.rmSync("_Anchor.toml");

  updateAnchorToml(selectedProgramId);

  run("anchor", ["build"]);
}

try {
  main();
} catch (error) {
  console.error("\nBuild script failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}