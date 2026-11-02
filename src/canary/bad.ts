// SEMGREP CANARY (2 November): a deliberately unsafe file on a throwaway branch, to prove the CI scan fails on it.
// Never merged; the branch is deleted after the run.
import express from "express";
import { exec } from "node:child_process";

const app = express();
app.get("/calc", (req, res) => {
  // eval on user input
  res.send(String(eval(String(req.query.expr))));
});
app.get("/run", (req, res) => {
  // a shell command built from user input
  exec(`ls ${String(req.query.dir)}`, (_e, out) => res.send(out));
});
export default app;
