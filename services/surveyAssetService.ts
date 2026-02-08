import QRCode from 'qrcode';

const sanitizeFileName = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return normalized.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'survey';
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const downloadDataUrl = (dataUrl: string, fileName: string) => {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

export const surveyAssetService = {
  async generateQrDataUrl(publicUrl: string): Promise<string> {
    return QRCode.toDataURL(publicUrl, {
      width: 560,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    });
  },

  async downloadQrPng(params: {
    publicUrl: string;
    surveyTitle: string;
  }): Promise<void> {
    const dataUrl = await surveyAssetService.generateQrDataUrl(params.publicUrl);
    const fileName = `${sanitizeFileName(params.surveyTitle)}-review-qr.png`;
    downloadDataUrl(dataUrl, fileName);
  },

  async openPopPrintWindow(params: {
    publicUrl: string;
    surveyTitle: string;
    surveyDescription?: string;
    positiveThreshold: number;
  }): Promise<void> {
    const qrDataUrl = await surveyAssetService.generateQrDataUrl(params.publicUrl);
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=980,height=760');
    if (!popup) {
      throw new Error('ポップアップを開けませんでした。ブラウザのポップアップブロックを解除してください。');
    }

    const safeTitle = escapeHtml(params.surveyTitle);
    const safeDescription = escapeHtml(params.surveyDescription || '');
    const safeUrl = escapeHtml(params.publicUrl);
    const thresholdText = `${params.positiveThreshold}点以上`;

    popup.document.write(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>${safeTitle} | QR POP</title>
    <style>
      :root { color-scheme: only light; }
      body {
        margin: 0;
        font-family: "Hiragino Sans", "Noto Sans JP", sans-serif;
        color: #111827;
        background: #f3f4f6;
      }
      .sheet {
        box-sizing: border-box;
        width: 210mm;
        min-height: 297mm;
        margin: 16px auto;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 20mm 16mm;
      }
      .title {
        font-size: 34px;
        line-height: 1.3;
        font-weight: 800;
        margin: 0;
      }
      .subtitle {
        margin-top: 14px;
        font-size: 18px;
        line-height: 1.7;
        color: #374151;
      }
      .badge {
        margin-top: 14px;
        display: inline-block;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fcd34d;
        border-radius: 9999px;
        padding: 4px 12px;
        font-size: 13px;
        font-weight: 700;
      }
      .qr-wrap {
        margin-top: 20px;
        border: 2px dashed #9ca3af;
        border-radius: 12px;
        padding: 16px;
        text-align: center;
      }
      .qr-wrap img {
        width: 240px;
        height: 240px;
      }
      .qr-label {
        margin-top: 10px;
        font-size: 20px;
        font-weight: 700;
      }
      .note {
        margin-top: 18px;
        font-size: 12px;
        color: #6b7280;
        line-height: 1.7;
        word-break: break-all;
      }
      .actions {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin: 12px auto 20px;
      }
      .actions button {
        border: none;
        border-radius: 10px;
        background: #111827;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        padding: 8px 14px;
        cursor: pointer;
      }
      @media print {
        body { background: #fff; }
        .sheet {
          margin: 0;
          border: none;
          border-radius: 0;
          width: auto;
          min-height: auto;
        }
        .actions { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="actions">
      <button onclick="window.print()">印刷 / PDF保存</button>
      <button onclick="window.close()">閉じる</button>
    </div>
    <div class="sheet">
      <h1 class="title">アンケートにご協力ください</h1>
      <p class="subtitle">${safeTitle}</p>
      ${safeDescription ? `<p class="subtitle">${safeDescription}</p>` : ''}
      <div class="badge">高評価導線: ${thresholdText}</div>
      <div class="qr-wrap">
        <img src="${qrDataUrl}" alt="アンケートQRコード" />
        <div class="qr-label">スマホで読み取り</div>
      </div>
      <p class="note">公開URL: ${safeUrl}</p>
    </div>
    <script>
      setTimeout(() => window.focus(), 100);
    </script>
  </body>
</html>`);
    popup.document.close();
  },
};
