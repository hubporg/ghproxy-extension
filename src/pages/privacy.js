document.addEventListener('DOMContentLoaded', async () => {
  const btnAccept = document.getElementById('btn-accept');
  const btnReject = document.getElementById('btn-reject');
  const privacyContent = document.getElementById('privacy-content');
  const rejectedNotice = document.getElementById('rejected-notice');

  const storageResult = await browser.storage.local.get('privacy_accepted');
  const hasAccepted = storageResult.privacy_accepted === true;
  const hasRejected = storageResult.privacy_accepted === false;

  if (hasAccepted) {
    rejectedNotice.style.display = 'none';
    privacyContent.style.display = 'block';
    btnAccept.textContent = '已同意';
    btnAccept.disabled = true;
    btnAccept.style.opacity = '0.5';
    btnReject.style.display = 'none';
    return;
  }

  if (hasRejected) {
    privacyContent.style.display = 'none';
    rejectedNotice.style.display = 'block';
    btnAccept.textContent = '重新考虑';
    btnReject.style.display = 'none';
  }

  btnAccept.addEventListener('click', async () => {
    await browser.storage.local.set({ privacy_accepted: true });
    btnAccept.textContent = '已同意，正在关闭...';
    btnAccept.disabled = true;

    browser.runtime.sendMessage({ type: 'PRIVACY_ACCEPTED' }).catch(() => {});

    setTimeout(() => {
      window.close();
    }, 800);
  });

  btnReject.addEventListener('click', async () => {
    await browser.storage.local.set({ privacy_accepted: false });
    privacyContent.style.display = 'none';
    rejectedNotice.style.display = 'block';
    btnAccept.textContent = '重新考虑';
    btnReject.style.display = 'none';

    browser.runtime.sendMessage({ type: 'PRIVACY_REJECTED' }).catch(() => {});
  });
});
