import React, { useState } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { MapPin, Phone, Globe, Navigation, Search, Star, TrendingUp, Calendar as CalendarIcon, Filter } from 'lucide-react';
import { PAGE_CARD_PADDED_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS } from './ui/pageLayout';

const dataPerformance = [
  { name: '1日', views: 4000, searches: 2400, actions: 1200 },
  { name: '2日', views: 3000, searches: 1398, actions: 900 },
  { name: '3日', views: 2000, searches: 9800, actions: 2290 },
  { name: '4日', views: 2780, searches: 3908, actions: 2000 },
  { name: '5日', views: 1890, searches: 4800, actions: 2181 },
  { name: '6日', views: 2390, searches: 3800, actions: 2500 },
  { name: '7日', views: 3490, searches: 4300, actions: 2100 },
];

const dataDiscovery = [
  { name: '直接検索 (指名)', value: 35 },
  { name: '間接検索 (発見)', value: 65 },
];

interface DashboardProps {
  isDarkMode: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({ isDarkMode }) => {
  const [dateRange, setDateRange] = useState('7days');

  // Colors
  const colors = {
    primary: '#0ea5e9', // Sky 500
    secondary: '#8b5cf6', // Violet 500
    accent: '#10b981', // Emerald 500
    bg: isDarkMode ? '#1f2937' : '#ffffff',
    text: isDarkMode ? '#f3f4f6' : '#111827',
    grid: isDarkMode ? '#374151' : '#f3f4f6',
  };

  const StatCard = ({ title, value, change, icon: Icon, colorClass }: any) => (
    <div className={`${PAGE_CARD_PADDED_CLASS} transition-all hover:shadow-md`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl ${colorClass} bg-opacity-10`}>
          <Icon className={`h-6 w-6 ${colorClass.replace('bg-', 'text-')}`} />
        </div>
        <div className={`flex items-center text-sm font-medium ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {change >= 0 ? '+' : ''}{change}%
          <TrendingUp size={14} className="ml-1" />
        </div>
      </div>
      <div>
        <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{value}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{title}</p>
      </div>
    </div>
  );

  return (
    <div className={`${PAGE_CONTAINER_CLASS} lg:space-y-8`}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h1 className={PAGE_HEADER_TITLE_CLASS}>ダッシュボード</h1>
           <p className={PAGE_HEADER_DESCRIPTION_CLASS}>店舗パフォーマンスをひと目で確認できます。</p>
        </div>
        
        <div
          id="dashboard-date-range-controls"
          className="flex items-center gap-3 bg-white dark:bg-gray-800 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
        >
           <button 
             onClick={() => setDateRange('7days')}
             className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dateRange === '7days' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50'}`}
           >
             過去7日間
           </button>
           <button 
             onClick={() => setDateRange('30days')}
             className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${dateRange === '30days' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50'}`}
           >
             過去30日間
           </button>
           <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 mx-1"></div>
           <button className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">
             <CalendarIcon size={18} />
           </button>
           <button className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">
             <Filter size={18} />
           </button>
        </div>
      </div>

      {/* MEO KPI Cards */}
      <div id="dashboard-kpi-cards" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="マップ表示回数" value="12,450" change={12.5} icon={MapPin} colorClass="bg-blue-500 text-blue-500" />
        <StatCard title="ルート検索数" value="856" change={5.2} icon={Navigation} colorClass="bg-green-500 text-green-500" />
        <StatCard title="通話クリック" value="124" change={-2.4} icon={Phone} colorClass="bg-purple-500 text-purple-500" />
        <StatCard title="ウェブサイト遷移" value="2,105" change={8.9} icon={Globe} colorClass="bg-orange-500 text-orange-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div id="dashboard-main-chart" className={`lg:col-span-2 ${PAGE_CARD_PADDED_CLASS}`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">検索パフォーマンス推移</h2>
            <div className="flex gap-2 text-sm">
               <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-primary-500"></span>表示回数</div>
               <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-secondary-500"></span>アクション数</div>
            </div>
          </div>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dataPerformance} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.primary} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={colors.primary} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorActions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.secondary} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={colors.secondary} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                <XAxis dataKey="name" stroke="#9ca3af" axisLine={false} tickLine={false} dy={10} />
                <YAxis stroke="#9ca3af" axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: colors.bg, borderColor: colors.grid, borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                  itemStyle={{ color: colors.text }}
                />
                <Area type="monotone" dataKey="views" stroke={colors.primary} strokeWidth={3} fillOpacity={1} fill="url(#colorViews)" />
                <Area type="monotone" dataKey="actions" stroke={colors.secondary} strokeWidth={3} fillOpacity={1} fill="url(#colorActions)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Search Breakdown */}
        <div id="dashboard-search-breakdown" className={`${PAGE_CARD_PADDED_CLASS} flex flex-col`}>
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-6">検索タイプの内訳</h2>
          <div className="flex-1 flex flex-col justify-center space-y-8">
             <div className="relative pt-2">
                <div className="flex justify-between text-sm font-medium mb-2 text-gray-600 dark:text-gray-300">
                   <span className="flex items-center gap-2"><Search size={16}/> 直接検索 (指名)</span>
                   <span className="text-gray-900 dark:text-white font-bold">35%</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                   <div className="bg-blue-500 h-3 rounded-full" style={{ width: '35%' }}></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">店舗名や住所で直接検索された割合</p>
             </div>

             <div className="relative pt-2">
                <div className="flex justify-between text-sm font-medium mb-2 text-gray-600 dark:text-gray-300">
                   <span className="flex items-center gap-2"><MapPin size={16}/> 間接検索 (発見)</span>
                   <span className="text-gray-900 dark:text-white font-bold">65%</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                   <div className="bg-green-500 h-3 rounded-full" style={{ width: '65%' }}></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">「近くのカフェ」等のカテゴリ検索で見つかった割合</p>
             </div>

             <div className="mt-auto pt-6 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                   <div>
                      <p className="text-sm text-gray-500">平均評価</p>
                      <div className="flex items-center gap-1 text-yellow-500 mt-1">
                         <Star fill="currentColor" size={20} />
                         <span className="text-2xl font-bold text-gray-800 dark:text-white">4.8</span>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-sm text-gray-500">総口コミ数</p>
                      <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">1,204<span className="text-sm font-normal text-gray-400 ml-1">件</span></p>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
