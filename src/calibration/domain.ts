export type RunStatus =
  | "draft"
  | "dry_run_ready"
  | "approved"
  | "running"
  | "succeeded"
  | "failed"
  | "execution_unknown";

export interface CorpusItem {
  id: string;
  order: number;
  text: string;
}

export interface CorpusDraft {
  workspaceId: string;
  revision: number;
  items: CorpusItem[];
}

export interface CorpusVersion {
  id: string;
  workspaceId: string;
  revision: number;
  items: readonly CorpusItem[];
  contentDigest: string;
  status: "active" | "superseded";
  publishedAt: string;
}

export interface ResolvedCalibrationRequest {
  contractDigest: string;
  coreDigest: string;
  corpusVersionId: string;
  corpusDigest: string;
  voiceRef: string;
  params: Record<string, unknown>;
  postproc: unknown;
}

export interface CalibrationRun {
  id: string;
  workspaceId: string;
  status: RunStatus;
  idempotencyKey: string;
  request: ResolvedCalibrationRequest;
  requestDigest: string;
  approval: { approvedAt: string; expiresAt: string; consumedAt: string | null } | null;
  reportId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalibrationReport {
  id: string;
  runId: string;
  request: ResolvedCalibrationRequest;
  requestDigest: string;
  metrics: Record<string, unknown>;
  artifacts: string[];
  providerResult: unknown;
  error: { code: string; message: string } | null;
  createdAt: string;
}

export interface VoiceProfile {
  id: string;
  workspaceId: string;
  voiceRef: string;
  wpmSnapshot: number;
  wpmAuthority: "python-voice-wpm";
  canonicalRef: string;
  sourceRunId: string;
  corpusVersionId: string;
  reportId: string;
  publishedAt: string;
}

export type RunEvent =
  | { type: "dry_run_succeeded" }
  | { type: "approve"; expiresAt: string }
  | { type: "execute" }
  | { type: "succeeded" }
  | { type: "failed" }
  | { type: "execution_unknown" };

type TransitionableRun = {
  status: RunStatus;
  approval?: CalibrationRun["approval"];
  [key: string]: unknown;
};

const transitions: Record<RunStatus, Partial<Record<RunEvent["type"], RunStatus>>> = {
  draft: { dry_run_succeeded: "dry_run_ready" },
  dry_run_ready: { approve: "approved" },
  approved: { execute: "running" },
  running: {
    succeeded: "succeeded",
    failed: "failed",
    execution_unknown: "execution_unknown",
  },
  succeeded: {},
  failed: {},
  execution_unknown: {},
};

export function transitionRun<T extends TransitionableRun>(run: T, event: RunEvent): T {
  const nextStatus = transitions[run.status]?.[event.type];
  if (!nextStatus) {
    throw new Error(`invalid transition: ${run.status} + ${event.type}`);
  }

  const nextRun = { ...run, status: nextStatus };

  if (event.type === "approve") {
    return {
      ...nextRun,
      approval: {
        approvedAt: new Date().toISOString(),
        expiresAt: event.expiresAt,
        consumedAt: null,
      },
    } as T;
  }

  if (event.type === "execute" && run.approval) {
    return {
      ...nextRun,
      approval: { ...run.approval, consumedAt: new Date().toISOString() },
    } as T;
  }

  return nextRun as T;
}
