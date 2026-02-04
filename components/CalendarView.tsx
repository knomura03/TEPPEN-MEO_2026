import React, { useState } from 'react';
import { MOCK_POSTS, HOLIDAYS } from '../constants';
import { Post, PostStatus, SocialPlatform } from '../types';
import { ChevronLeft, ChevronRight, Clock, CheckCircle, Calendar as CalendarIcon, Filter, Plus } from 'lucide-react';

// Helpers
const startOfMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

const endOfMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
};

const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const newDate = new Date(d);
  newDate.setDate(diff);
  return newDate;
};

const endOfWeek = (date: Date) => {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  return d;
};

const eachDayOfInterval = ({ start, end }: { start: Date; end: Date }) => {
  const days: Date[] = [];
  const day = new Date(start);
  const endDay = new Date(end);
  day.setHours(0,0,0,0);
  endDay.setHours(0,0,0,0);
  
  while (day <= endDay) {
    days.push(new Date(day));
    day.setDate(day.getDate() + 1);
  }
  return days;
};

const addMonths = (date: Date, amount: number) => {
  const newDate = new Date(date);
  const d = newDate.getDate();
  newDate.setMonth(newDate.getMonth() + amount);
  if (newDate.getDate() !== d) newDate.setDate(0);
  return newDate;
};

const subMonths = (date: Date, amount: number) => {
  const newDate = new Date(date);
  const d = newDate.getDate();
  newDate.setMonth(newDate.getMonth() - amount);
  if (newDate.getDate() !== d) newDate.setDate(0);
  return newDate;
};

const isSameMonth = (d1: Date, d2: Date) => {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
};

const isSameDay = (d1: Date, d2: Date) => {
  return d1.getFullYear() === d2.getFullYear() && 
         d1.getMonth() === d2.getMonth() && 
         d1.getDate() === d2.getDate();
};

const formatMonth = (date: Date) => {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
};

const formatTime = (date: Date) => {
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${h}:${min}`;
};

const getHolidayName = (date: Date) => {
  const key = `${date.getMonth() + 1}/${date.getDate()}`;
  return HOLIDAYS[key];
};

export const CalendarView: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [filterPlatform, setFilterPlatform] = useState<SocialPlatform | 'ALL'>('ALL');

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToToday = () => setCurrentDate(new Date());

  const getPostsForDay = (day: Date) => {
    return MOCK_POSTS.filter(post => {
      const targetDate = post.scheduledDate || post.publishedDate;
      if (!targetDate || !isSameDay(targetDate, day)) return false;
      
      if (filterPlatform !== 'ALL' && !post.platforms.includes(filterPlatform)) return false;
      return true;
    });
  };

  const handleDateClick = (date: Date) => {
    // 実際の実装では、ここでモーダルを開くか作成画面へ遷移し、初期日付をセットする
    alert(`${date.toLocaleDateString()} の新規投稿を作成します`);
  };

  const statusColor = (status: PostStatus) => {
    switch (status) {
      case PostStatus.PUBLISHED: return 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800';
      case PostStatus.SCHEDULED: return 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
      case PostStatus.DRAFT: return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600';
      case PostStatus.FAILED: return 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800';
      default: return 'bg-gray-100';
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <CalendarIcon className="text-primary-500" />
            運用カレンダー
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">キャンペーン計画と投稿スケジュールの管理</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
           <div className="relative">
              <Filter size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <select 
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value as any)}
                className="pl-9 pr-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="ALL">全てのプラットフォーム</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="FACEBOOK">Facebook</option>
                <option value="GOOGLE_BUSINESS">Google Business</option>
              </select>
           </div>

           <div className="flex items-center space-x-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg p-1">
             <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded text-gray-600 dark:text-gray-300"><ChevronLeft size={18} /></button>
             <span className="px-2 text-sm font-bold text-gray-800 dark:text-white min-w-[100px] text-center">{formatMonth(currentDate)}</span>
             <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded text-gray-600 dark:text-gray-300"><ChevronRight size={18} /></button>
           </div>
           
           <button onClick={goToToday} className="px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600">今日</button>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
        {/* Weekday Headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          {['日', '月', '火', '水', '木', '金', '土'].map((day, idx) => (
            <div key={idx} className={`py-3 text-center text-sm font-semibold ${idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'}`}>
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 grid grid-cols-7 auto-rows-fr">
          {days.map((day, dayIdx) => {
            const dayPosts = getPostsForDay(day);
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());
            const holidayName = getHolidayName(day);

            return (
              <div 
                key={day.toString()} 
                onClick={() => handleDateClick(day)}
                className={`min-h-[100px] border-b border-r border-gray-100 dark:border-gray-700 p-2 flex flex-col transition-all hover:bg-primary-50/30 dark:hover:bg-primary-900/10 group cursor-pointer relative
                  ${!isCurrentMonth ? 'bg-gray-50/50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600' : 'bg-white dark:bg-gray-800'}
                `}
              >
                {/* Add Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="bg-primary-600 text-white rounded-full p-2 shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <Plus size={20} />
                    </div>
                </div>

                <div className="flex justify-between items-start mb-1 z-10">
                  <div className="flex flex-col">
                    <span className={`
                      text-sm w-7 h-7 flex items-center justify-center rounded-full font-medium
                      ${isToday ? 'bg-primary-600 text-white font-bold shadow-md' : holidayName ? 'text-red-500' : 'text-gray-900 dark:text-gray-200'}
                    `}>
                      {day.getDate()}
                    </span>
                    {holidayName && (
                        <span className="text-[10px] text-red-500 font-medium ml-1 mt-0.5 truncate max-w-[80px]">{holidayName}</span>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-1 overflow-y-auto z-10 custom-scrollbar">
                  {dayPosts.map(post => (
                    <div 
                      key={post.id}
                      className={`text-[10px] p-1.5 rounded-md border mb-1 truncate shadow-sm transition-transform hover:scale-[1.02] ${statusColor(post.status)}`}
                      title={post.content}
                      onClick={(e) => {
                          e.stopPropagation();
                          alert(`投稿詳細: ${post.content}`);
                      }}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        {post.status === PostStatus.PUBLISHED ? <CheckCircle size={10} /> : <Clock size={10} />}
                        <span className="truncate font-bold">{formatTime(post.scheduledDate || post.publishedDate || new Date())}</span>
                        <div className="flex gap-0.5 ml-auto">
                           {post.platforms.map(p => (
                               <span key={p} className={`w-1.5 h-1.5 rounded-full ${
                                   p === 'INSTAGRAM' ? 'bg-pink-500' : 
                                   p === 'FACEBOOK' ? 'bg-blue-600' : 
                                   'bg-blue-400'
                               }`} />
                           ))}
                        </div>
                      </div>
                      <div className="truncate opacity-90">{post.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};