import React, { useState } from 'react';
import { User, Role, SocialAccount } from '../types';
import { MOCK_ACCOUNTS } from '../constants';
import { Save, Lock, User as UserIcon, Mail, Link as LinkIcon, AlertTriangle, Key, Shield, MapPin, Store, CreditCard } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface SettingsViewProps {
  currentUser: User;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const [activeTab, setActiveTab] = useState<'PROFILE' | 'STORE' | 'INTEGRATIONS' | 'SYSTEM'>('PROFILE');
  
  // Profile State
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Store Info State
  const [storeName, setStoreName] = useState('TEPPEN総本店');
  const [address, setAddress] = useState(currentUser.storeInfo?.address || '');
  const [phone, setPhone] = useState(currentUser.storeInfo?.phone || '');
  const [businessHours, setBusinessHours] = useState(currentUser.storeInfo?.businessHours || '');
  const [category, setCategory] = useState(currentUser.storeInfo?.category || '');

  // Integrations State (Mock)
  const [accounts, setAccounts] = useState<SocialAccount[]>(MOCK_ACCOUNTS);

  // System State (Admin Only)
  const [apiKey, setApiKey] = useState('****************************');

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    addNotification('プロフィール更新', 'ユーザー情報を保存しました。', 'SUCCESS');
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    addNotification('店舗情報更新', 'MEO対策用の店舗情報を更新しました。', 'SUCCESS');
  }

  const handleToggleConnection = (id: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id === id) {
        const newState = !acc.isConnected;
        addNotification(
          newState ? '連携完了' : '連携解除', 
          `${acc.platform}との連携を${newState ? '開始' : '解除'}しました。`,
          newState ? 'SUCCESS' : 'INFO'
        );
        return { ...acc, isConnected: newState };
      }
      return acc;
    }));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-white">設定</h1>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-gray-50 dark:bg-gray-900/50 border-r border-gray-100 dark:border-gray-700 p-4">
          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('PROFILE')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === 'PROFILE' 
                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <UserIcon size={18} />
              <span>プロフィール・プラン</span>
            </button>
            <button
              onClick={() => setActiveTab('STORE')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === 'STORE' 
                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Store size={18} />
              <span>店舗情報 (MEO)</span>
            </button>
            <button
              onClick={() => setActiveTab('INTEGRATIONS')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === 'INTEGRATIONS' 
                  ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <LinkIcon size={18} />
              <span>SNS連携設定</span>
            </button>
            {currentUser.role === Role.ADMIN && (
              <button
                onClick={() => setActiveTab('SYSTEM')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === 'SYSTEM' 
                    ? 'bg-white dark:bg-gray-800 text-primary-600 shadow-sm font-semibold' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Shield size={18} />
                <span>システム管理</span>
              </button>
            )}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {activeTab === 'PROFILE' && (
            <div className="max-w-2xl space-y-8">
               {/* Plan Info */}
               <div className="bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl p-6 text-white shadow-lg">
                   <div className="flex justify-between items-start">
                       <div>
                           <p className="text-primary-100 text-sm font-medium mb-1">現在のプラン</p>
                           <h3 className="text-2xl font-bold">{currentUser.plan || 'FREE'} PLAN</h3>
                           <p className="text-sm text-primary-100 mt-2">次回更新日: 2024年12月31日</p>
                       </div>
                       <CreditCard className="text-primary-200 w-12 h-12 opacity-50" />
                   </div>
               </div>

              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">基本情報</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">アカウントの表示名や連絡先情報を管理します。</p>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="flex items-center gap-6">
                  <img 
                    src={currentUser.avatarUrl} 
                    alt="avatar" 
                    className="w-20 h-20 rounded-full object-cover border-4 border-gray-100 dark:border-gray-700 shadow-sm"
                  />
                  <button type="button" className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                    画像を変更
                  </button>
                </div>

                <div className="grid gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">表示名</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">メールアドレス</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                      <input 
                        type="email" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-100 dark:border-gray-700">
                   <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">パスワード変更</h3>
                   <div className="grid gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">現在のパスワード</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">新しいパスワード</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                   </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button type="submit" className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 dark:shadow-none transition-all">
                    <Save size={18} />
                    保存する
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'STORE' && (
              <div className="max-w-2xl space-y-8">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">店舗情報設定</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Googleマップ等に反映される正確な店舗情報を入力してください。</p>
                  </div>

                  <form onSubmit={handleSaveStore} className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">店舗名 (NAP: Name)</label>
                        <input 
                            type="text" 
                            value={storeName}
                            onChange={(e) => setStoreName(e.target.value)}
                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">住所 (NAP: Address)</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 text-gray-400" size={18} />
                            <input 
                                type="text" 
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="例: 東京都港区六本木..."
                                className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">電話番号 (NAP: Phone)</label>
                            <input 
                                type="text" 
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="03-xxxx-xxxx"
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">カテゴリ</label>
                            <input 
                                type="text" 
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="例: イタリア料理店"
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                            />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">営業時間</label>
                        <textarea 
                            value={businessHours}
                            onChange={(e) => setBusinessHours(e.target.value)}
                            placeholder="月: 10:00-19:00&#10;火: 10:00-19:00..."
                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none transition-all h-32"
                        />
                      </div>

                      <div className="flex justify-end pt-4">
                        <button type="submit" className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 dark:shadow-none transition-all">
                            <Save size={18} />
                            店舗情報を保存
                        </button>
                    </div>
                  </form>
              </div>
          )}

          {activeTab === 'INTEGRATIONS' && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">SNS連携設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">投稿や分析を行うアカウントを接続します。</p>
              </div>

              <div className="grid gap-4">
                {accounts.map(account => (
                  <div key={account.id} className="flex items-center justify-between p-5 bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded-2xl shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`
                        w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold
                        ${account.platform === 'INSTAGRAM' ? 'bg-gradient-to-tr from-yellow-400 to-purple-600' : 
                          account.platform === 'FACEBOOK' ? 'bg-blue-600' :
                          account.platform === 'GOOGLE_BUSINESS' ? 'bg-blue-500' :
                           'bg-gray-400'}
                      `}>
                        {account.platform[0]}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-800 dark:text-white">{account.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{account.handle}</p>
                      </div>
                    </div>
                    <div>
                      {account.isConnected ? (
                        <button 
                          onClick={() => handleToggleConnection(account.id)}
                          className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                        >
                          連携解除
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleToggleConnection(account.id)}
                          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-md shadow-primary-200 dark:shadow-none transition-all"
                        >
                          連携する
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                
                {currentUser.role === Role.ADMIN && (
                   <div className="mt-4 p-4 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-center">
                      <button className="text-primary-600 font-medium hover:underline">+ 新しいプラットフォームを追加 (Admin Only)</button>
                   </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'SYSTEM' && currentUser.role === Role.ADMIN && (
             <div className="max-w-2xl space-y-8">
               <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4 rounded-xl flex gap-3">
                 <AlertTriangle className="text-orange-600 dark:text-orange-400 flex-shrink-0" />
                 <div>
                   <h3 className="font-bold text-orange-800 dark:text-orange-300 text-sm">開発者エリア</h3>
                   <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">この設定を変更するとシステム全体に影響が及びます。</p>
                 </div>
               </div>

               <div>
                 <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">API設定</h2>
                 <div className="space-y-4">
                   <div>
                     <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Google Gemini API Key</label>
                     <div className="flex gap-2">
                       <div className="relative flex-1">
                          <Key className="absolute left-3 top-3 text-gray-400" size={18} />
                          <input 
                            type="password" 
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="pl-10 w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl font-mono text-sm"
                          />
                       </div>
                       <button className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm hover:bg-gray-900 transition-colors">更新</button>
                     </div>
                   </div>
                 </div>
               </div>
               
               <div>
                  <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">システムメンテナンス</h2>
                  <div className="flex gap-4">
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">キャッシュクリア</button>
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">ログダウンロード</button>
                  </div>
               </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};