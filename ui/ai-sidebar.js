(function () {
    const api = window.pyBrowser;
    const panel = document.getElementById('ai-sidebar');
    const input = document.getElementById('ai-input');
    const out = document.getElementById('ai-output');
    const btnSend = document.getElementById('ai-send');
    const btnClose = document.getElementById('ai-sidebar-close');
    const btnOpen = document.getElementById('btn-ai-sidebar');

    function toggle() {
        if (panel) panel.classList.toggle('active');
    }

    if (btnOpen) btnOpen.addEventListener('click', toggle);
    if (btnClose) btnClose.addEventListener('click', () => panel && panel.classList.remove('active'));

    if (api && api.onToggleAi) {
        api.onToggleAi(toggle);
    }

    async function send() {
        const text = (input && input.value) || '';
        if (!text.trim()) return;
        if (out) out.textContent = 'Thinking…';
        try {
            const res = await api.aiAgentQuery({
                text: text.trim(),
                context: { url: window.location.href }
            });
            const msg = (res && res.message) || JSON.stringify(res);
            if (out) out.textContent = msg;
            const actions = res && res.actions;
            if (actions && actions.length && window.__ckApplyAgentActions) {
                await window.__ckApplyAgentActions(actions);
            }
        } catch (e) {
            if (out) out.textContent = 'Error: ' + (e.message || String(e));
        }
    }

    if (btnSend) btnSend.addEventListener('click', () => send());
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
            }
        });
    }
})();
