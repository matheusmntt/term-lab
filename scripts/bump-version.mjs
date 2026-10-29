#!/usr/bin/env node
// Mantém a versão alinhada em package.json, Cargo.toml, tauri.conf.json,
// .release-please-manifest.json e Casks/term-lab.rb.
//
// Uso: npm run version:bump -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2]?.replace(/^v/, "").trim();
if (!next || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error("Uso: npm run version:bump -- <major.minor.patch>");
  process.exit(1);
}

function updateJson(path, mutate) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  mutate(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

updateJson("package.json", (d) => { d.version = next; });
updateJson("src-tauri/tauri.conf.json", (d) => { d.version = next; });
updateJson(".release-please-manifest.json", (d) => { d["."] = next; });

const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^(version\s*=\s*")[^"]+(")/m,
  `$1${next}$2`,
);
writeFileSync(cargoPath, cargo);

const caskPath = "Casks/term-lab.rb";
const cask = readFileSync(caskPath, "utf8").replace(
  /^(  version\s+")[^"]+(")/m,
  `$1${next}$2`,
);
writeFileSync(caskPath, cask);

console.log(`Versão atualizada para ${next} em todos os manifestos.`);
