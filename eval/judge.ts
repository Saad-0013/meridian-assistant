import fs from 'fs';
import path from 'path';
import { Langfuse } from 'langfuse';

const lf = new Langfuse();

const JUDGE_PROMPT = `
You are an expert evaluator for a banking AI.
You will be given a QUESTION, the RETRIEVED_PASSAGES from the bank handbook, and the AI's ANSWER.
Your job is to determine if the ANSWER is strictly grounded in the RETRIEVED_PASSAGES.

Output exactly and only valid JSON in this format:
{
  "verdict": "grounded" | "ungrounded",
  "unsupported_claims": ["list any claims in the answer not found in the passages", "or empty array"],
  "reasoning": "One sentence explaining why."
}
`;

async function runJudge() {
  const goldenPath = path.join(process.cwd(), 'eval', 'golden.json');
  const resultsPath = path.join(process.cwd(), 'eval', 'results-v1.json');
  
  const cases = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  console.log(`Starting LLM Judge for ${results.length} traces...\n`);

  for (const res of results) {
    if (!res.traceId) continue;

    // Read the exact question, passages, and answer from the local files
    const question = cases.find((c: any) => c.id === res.id)?.question || "";
    const answer = res.reply || "No answer";
    const passages = res.citations ? JSON.stringify(res.citations) : "None";
    
    // Call Groq to judge
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0, // Temperature 0 is strictly required for the judge
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          { role: "user", content: `QUESTION:\n${question}\n\nRETRIEVED_PASSAGES:\n${passages}\n\nANSWER:\n${answer}` }
        ]
      })
    });

    const groqData = await groqRes.json();
    const verdictJson = JSON.parse(groqData.choices[0].message.content);

    const isGrounded = verdictJson.verdict === "grounded";

    console.log(`[${isGrounded ? 'GROUNDED' : 'UNGROUNDED'}] ${res.id}`);

    // Push the grounded score to the exact same trace
    await lf.score({
      traceId: res.traceId,
      name: "grounded",
      value: isGrounded ? 1 : 0,
      comment: verdictJson.reasoning
    });

    // Rate limit protection
    await new Promise(r => setTimeout(r, 2000));
  }

  await lf.flush(); // Crucial flush command as required by the assignment
  console.log("\nJudging complete. Scores pushed to Langfuse.");
}

runJudge();
