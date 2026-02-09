import React, { useMemo } from 'react';

type InvoiceRow = {
  id: string;
  issuedAt: string;
  amount: string;
  status: string;
};

const BillingView: React.FC = () => {
  const invoices = useMemo<InvoiceRow[]>(
    () => [
      { id: 'INV-2026-02', issuedAt: '2026-02-01', amount: '¥9,800', status: '支払い済み' },
      { id: 'INV-2026-01', issuedAt: '2026-01-01', amount: '¥9,800', status: '支払い済み' },
    ],
    []
  );

  return (
    <div className="space-y-6" data-testid="billing-view-root">
      <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">課金・請求</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          サブスクリプション状況と請求履歴を管理します。
        </p>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <article
          data-testid="billing-plan-current"
          className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-primary-600 dark:text-primary-400 font-bold">
                Current Plan
              </p>
              <h4 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">PROFESSIONAL</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                月額課金・店舗数上限は契約条件に従います。
              </p>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
              ACTIVE
            </span>
          </div>
        </article>

        <article className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">次回請求日</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-2">2026-03-01</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">請求予定額: ¥9,800</p>
          <button
            type="button"
            data-testid="billing-upgrade"
            className="mt-5 w-full rounded-xl bg-primary-600 text-white font-semibold py-2.5 hover:bg-primary-700 transition-colors"
          >
            プラン変更（準備中）
          </button>
        </article>
      </section>

      <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100">請求履歴</h4>
          <button
            type="button"
            data-testid="invoice-download"
            className="rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            最新請求書をダウンロード
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-2 pr-4 font-semibold">請求ID</th>
                <th className="py-2 pr-4 font-semibold">発行日</th>
                <th className="py-2 pr-4 font-semibold">金額</th>
                <th className="py-2 font-semibold">状態</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((row) => (
                <tr key={row.id} className="border-b border-gray-50 dark:border-gray-700/70 text-gray-800 dark:text-gray-200">
                  <td className="py-3 pr-4">{row.id}</td>
                  <td className="py-3 pr-4">{row.issuedAt}</td>
                  <td className="py-3 pr-4">{row.amount}</td>
                  <td className="py-3">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6">
        <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">PWA</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          ホーム画面に追加すると、アプリのようにすぐ起動できます。
        </p>
        <button
          type="button"
          data-testid="pwa-install-button"
          className="rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 px-4 py-2.5 text-sm font-semibold"
        >
          ホーム画面に追加
        </button>
      </section>
    </div>
  );
};

export { BillingView };
