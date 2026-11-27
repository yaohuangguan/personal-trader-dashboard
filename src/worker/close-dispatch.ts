/**
 * Worker cron → GitHub workflow_dispatch for the daily closing screen.
 * Cloudflare cron triggers fire on time, while GitHub scheduled runs have been
 * starting hours late. Without GITHUB_DISPATCH_TOKEN this is a no-op.
 */
export const CLOSE_DISPATCH_CRON = '25 7 * * MON-FRI';
export const DEFAULT_GITHUB_REPO = 'yaohuangguan/personal-trader-dashboard';
export const CLOSE_WORKFLOW = 'close-screen.yml';
export type DispatchEnv = {GITHUB_DISPATCH_TOKEN?: string; GITHUB_REPO?: string; GITHUB_REF?: string};
export type DispatchResult = {dispatched: boolean; status?: number; reason: string};

/** Builds the workflow_dispatch request, or null when dispatch is not configured. */
export function closeDispatchRequest(env: DispatchEnv): Request | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) return null;
  const repo = env.GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO, ref = env.GITHUB_REF?.trim() || 'master';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w./-]{1,100}$/.test(ref)) return null;
  return new Request(`https://api.github.com/repos/${repo}/actions/workflows/${CLOSE_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MarketAtlas-Close-Cron', 'content-type': 'application/json'},
    body: JSON.stringify({ref}),
  });
}

export async function dispatchCloseWorkflow(env: DispatchEnv, fetcher: (request: Request) => Promise<Response> = request => fetch(request)): Promise<DispatchResult> {
  const request = closeDispatchRequest(env);
  if (!request) return {dispatched: false, reason: env.GITHUB_DISPATCH_TOKEN ? 'GITHUB_REPO or GITHUB_REF is invalid' : 'GITHUB_DISPATCH_TOKEN is not configured'};
  try {
    const response = await fetcher(request);
    // GitHub answers 204 No Content on success.
    if (response.ok) return {dispatched: true, status: response.status, reason: 'workflow_dispatch accepted'};
    return {dispatched: false, status: response.status, reason: 'GitHub API HTTP ' + response.status + ': ' + (await response.text()).slice(0, 200)};
  } catch (e) {
    return {dispatched: false, reason: e instanceof Error ? e.message : String(e)};
  }
}
