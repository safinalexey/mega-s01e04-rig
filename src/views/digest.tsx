import type { NightDigest } from '../digest/types.js';

function missing(value: string | null): string {
  return value ?? '—';
}

export function DigestPage(props: { digest: NightDigest }) {
  const { digest } = props;

  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>{digest.badLines} bad {digest.badLines === 1 ? 'line' : 'lines'}</p>
      {digest.rows.length === 0 ? (
        <p>nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first time</th>
              <th>last time</th>
            </tr>
          </thead>
          <tbody>
            {[...digest.rows]
              .sort((a, b) => a.job.localeCompare(b.job))
              .map((row) => {
                const warning = row.retries >= 3 || row.lastStatus === 'fail';
                return (
                  <tr class={warning ? 'warn' : undefined}>
                    <td>{row.job}</td>
                    <td>{missing(row.owner)}</td>
                    <td>{row.runs}</td>
                    <td>{row.retries}</td>
                    <td>{row.lastStatus}</td>
                    <td>{missing(row.lastError)}</td>
                    <td>{row.firstAt}</td>
                    <td>{row.lastAt}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </>
  );
}
