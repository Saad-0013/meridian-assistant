import fs from 'fs';
import path from 'path';
import { Langfuse } from 'langfuse';

// Initialize Langfuse (it automatically reads your .env.local keys)
const lf = new Langfuse();

// B3: Normalise before comparing to prevent false negatives on formatting
function normalise(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00a3\s?(\d+)/g, "$1 pounds") 
    .replace(/\s+/g, " ")
    .trim();
}

async function runEvaluation() {
  const goldenPath = path.join(process.cwd(), 'eval', 'golden.json');
  const cases = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
  
  const results = [];
  let failures = 0;

  console.log(`Starting evaluation for ${cases.length} cases...\n`);

  for (const c of cases) {
    let responseJson;
    let success = false;

    // B2: Retry once on a 429 rather than crashing the whole run
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("http://localhost:3000/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: c.question }] })
        });

        if (res.status === 429) {
          throw new Error("429");
        }

        responseJson = await res.json();
        success = true;
        break; // Success, exit retry loop
      } catch (e: any) {
        if (e.message !== "429" || attempt === 2) {
          console.error(`[ERROR] Case ${c.id} failed to execute:`, e);
          break;
        }
        console.log(`[WARN] 429 Rate Limit on ${c.id}. Retrying in ${5000 * (attempt + 1)}ms...`);
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      }
    }

    if (!success || !responseJson) {
      failures++;
      continue;
    }

    const { reply = "", traceId, subgraph, citations = [] } = responseJson;
    
    // B3: Calculate Scores
    const routingCorrect = subgraph === c.expected_subgraph;
    
    const normalisedReply = normalise(reply);
    let answerCorrect = true;
    let missingTerms = [];
    
    if (c.expect === "answer") {
      for (const term of c.must_contain) {
        if (!normalisedReply.includes(normalise(term))) {
          answerCorrect = false;
          missingTerms.push(term);
        }
      }
    } else if (c.expect === "refuse") {
      answerCorrect = normalisedReply.includes(normalise("I cannot answer that"));
    }

    const retrievalHit = citations.some((cite: any) => 
      c.expected_source && cite.source && cite.source.includes(c.expected_source)
    );

    console.log(`[${answerCorrect ? 'PASS' : 'FAIL'}] ${c.id}: ${c.question}`);

    // B4: Push scores to Langfuse attached to the specific traceId
    if (traceId) {
      await lf.score({
        traceId: traceId,
        name: "routing_correct",
        value: routingCorrect ? 1 : 0
      });

      await lf.score({
        traceId: traceId,
        name: "answer_correct",
        value: answerCorrect ? 1 : 0,
        comment: answerCorrect ? undefined : `Missing: ${missingTerms.join(", ")}`
      });

      if (c.expect === "answer") {
        await lf.score({
          traceId: traceId,
          name: "retrieval_hit",
          value: retrievalHit ? 1 : 0
        });
      }
    }

    results.push({ id: c.id, routingCorrect, answerCorrect, retrievalHit, traceId, reply, citations });


    // Pause between calls to avoid token limits
    await new Promise(r => setTimeout(r, 3500));
  }

  // B4: Do not skip the flush
  await lf.flush();

  // Save local results
  fs.writeFileSync(path.join(process.cwd(), 'eval', 'results-v1.json'), JSON.stringify(results, null, 2));
  
  console.log(`\nEvaluation complete. Results saved to eval/results-v1.json`);
  console.log(`Execution failures: ${failures}`);
}

runEvaluation();
