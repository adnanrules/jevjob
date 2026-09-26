import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Runs before each test file is imported. Test files may still pick their own scratch folder.
process.env.JEVJOB_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "jevjob-test-"));
