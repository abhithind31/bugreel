(async function() {
  try {
    // Load the generated preview HTML from session storage
    const data = await chrome.storage.session.get('PREVIEW_HTML');
    const html = data && data.PREVIEW_HTML ? data.PREVIEW_HTML : '<!doctype html><html><body><p>Preview not available.</p></body></html>';

    // Render the preview HTML inside the iframe
    const frame = document.getElementById('previewFrame');
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    frame.src = url;

    // Wire action buttons at top-level (extension context)
    document.getElementById('saveBtn').addEventListener('click', async () => {
      try {
        const notes = (document.getElementById('notes').value || '').trim();
        const resp = await chrome.runtime.sendMessage({ type: 'SAVE_REPORT', notes });
        if (resp && resp.success) {
          alert('Report saved successfully!');
          window.close();
        }
      } catch (e) {
        console.error('PREVIEW PAGE: Save failed', e);
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
  } catch (err) {
    console.error('PREVIEW PAGE: Initialization error', err);
  }
})();


