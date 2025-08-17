(async function() {
  try {
    const data = await chrome.storage.session.get('PREVIEW_HTML');
    const html = data && data.PREVIEW_HTML ? data.PREVIEW_HTML : '<!doctype html><html><body><p>Preview not available.</p></body></html>';

    const frame = document.getElementById('previewFrame');
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    frame.src = url;

    document.getElementById('saveBtn').addEventListener('click', async () => {
      try {
        const notes = (document.getElementById('notes').value || '').trim();
        const resp = await chrome.runtime.sendMessage({ type: 'SAVE_REPORT', notes });
        if (resp && resp.success) {
          alert('Report saved.');
          window.close();
        }
      } catch (e) {
        console.error('Preview: save failed', e);
        alert('Failed to save report: ' + (e && e.message ? e.message : 'Unknown error'));
      }
    });

    document.getElementById('cancelBtn').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'CANCEL_PREVIEW' });
        window.close();
      } catch (e) {
        window.close();
      }
    });

    document.getElementById('restartBtn').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'RESTART_RECORDING' });
        window.close();
      } catch (e) {
        window.close();
      }
    });

    // Simple one-click GitHub/Jira issue creation (opens prefilled URLs)
    const makeSummary = () => {
      const n = (document.getElementById('notes').value || '').trim();
      const page = (new DOMParser().parseFromString(html, 'text/html').querySelector('title')?.textContent || '').trim();
      return `BugReel: ${page || 'Recording'}${n ? ' — ' + n : ''}`.slice(0, 120);
    };

    const makeBody = async () => {
      const ts = new Date().toISOString();
      const env = await chrome.storage.session.get(['environmentData']);
      const envStr = env && env.environmentData ? '\n\n### Environment\n```json\n' + JSON.stringify(env.environmentData, null, 2) + '\n```' : '';
      const body = `### Summary\n${(document.getElementById('notes').value || '').trim() || 'See attached HTML report.'}\n\n### Steps\n- See video in attached HTML report\n\n### Generated\n${ts}${envStr}`;
      return body;
    };

    const openUrl = (url) => window.open(url, '_blank');

    document.getElementById('jiraBtn').addEventListener('click', async () => {
      const summary = encodeURIComponent(makeSummary());
      const description = encodeURIComponent(await makeBody());
      const cfg = (window.BUGREEL_CONFIG && window.BUGREEL_CONFIG.jira) || {};
      const base = cfg.baseUrl || 'https://your-domain.atlassian.net';
      const pid = cfg.projectId ? `&pid=${encodeURIComponent(cfg.projectId)}` : '';
      const type = cfg.issueTypeId ? `&issuetype=${encodeURIComponent(cfg.issueTypeId)}` : '';
      openUrl(`${base}/secure/CreateIssueDetails!init.jspa?summary=${summary}&description=${description}${pid}${type}`);
    });
  } catch (err) {
    console.error('Preview: initialization error', err);
  }
})();


