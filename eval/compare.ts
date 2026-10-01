import fs from 'fs';
import path from 'path';

const v1Path = path.join(process.cwd(), 'eval', 'results-v1.json');
const v2Path = path.join(process.cwd(), 'eval', 'results-v2.json');

if (!fs.existsSync(v1Path) || !fs.existsSync(v2Path)) {
  console.error("Missing results file. Ensure both eval/results-v1.json and eval/results-v2.json exist.");
  process.exit(1);
}

const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf-8'));
const v2 = JSON.parse(fs.readFileSync(v2Path, 'utf-8'));

const metrics = ['routingCorrect', 'answerCorrect', 'retrievalHit'];

console.log("=== SCORE TOTALS (v1 -> v2) ===");
for (const m of metrics) {
  const score1 = v1.filter((r: any) => r[m]).length;
  const score2 = v2.filter((r: any) => r[m]).length;
  console.log(`${m}: ${score1}/${v1.length} -> ${score2}/${v2.length}`);
}

console.log("\n=== VERDICT CHANGES (v1 -> v2) ===");
for (const m of metrics) {
  let fixed = 0;
  let broken = 0;
  for (let i = 0; i < v1.length; i++) {
    if (!v1[i][m] && v2[i]?.[m]) fixed++;
    if (v1[i][m] && !v2[i]?.[m]) broken++;
  }
  console.log(`${m}: ${fixed} fixed, ${broken} broken`);
}
