import { runSyntheticEvaluation } from "./evaluator";

const metrics = runSyntheticEvaluation();

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
