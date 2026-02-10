import React, { useEffect, useState, useRef } from 'react';
import { MOCK_POSTS, HOLIDAYS, MOCK_ACCOUNTS } from '../constants';
import { Post, PostStatus, Role, SocialPlatform, User } from '../types';
import { ChevronLeft, ChevronRight, Clock, CheckCircle, AlertCircle, Filter, Plus, X, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { postsService } from '../services/postsService';
import { useNotification } from '../contexts/NotificationContext';
import { useStore } from '../contexts/StoreContext';
import { postMediaService } from '../services/postMediaService';
import { geminiService } from '../services/geminiService';
import { ModalPortal } from './ModalPortal';
import { PAGE_CARD_CLASS, PAGE_CONTAINER_CLASS, PAGE_HEADER_DESCRIPTION_CLASS, PAGE_HEADER_TITLE_CLASS } from './ui/pageLayout';

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

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = ('0' + (date.getMonth() + 1)).slice(-2);
  const d = ('0' + date.getDate()).slice(-2);
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}/${m}/${d} ${h}:${min}`;
};

const toDatetimeLocalValue = (date: Date) => {
  const y = date.getFullYear();
  const m = ('0' + (date.getMonth() + 1)).slice(-2);
  const d = ('0' + date.getDate()).slice(-2);
  const h = ('0' + date.getHours()).slice(-2);
  const min = ('0' + date.getMinutes()).slice(-2);
  return `${y}-${m}-${d}T${h}:${min}`;
};

const getHolidayName = (date: Date) => {
  const key = `${date.getMonth() + 1}/${date.getDate()}`;
  return HOLIDAYS[key];
};

interface CalendarViewProps {
  currentUser: User;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ currentUser }) => {
  const { addNotification } = useNotification();
  const { activeStoreId } = useStore();
  const isApprovalRequester = currentUser.role === Role.USER;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [filterPlatform, setFilterPlatform] = useState<SocialPlatform | 'ALL'>('ALL');
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDateTime, setCreateDateTime] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createPlatforms, setCreatePlatforms] = useState<SocialPlatform[]>([]);
  const [createImages, setCreateImages] = useState<File[]>([]);
  const [createImagePreviewUrls, setCreateImagePreviewUrls] = useState<string[]>([]);
  const [aiTopic, setAiTopic] = useState('');
  const [aiTone, setAiTone] = useState('親しみやすい');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxFileSizeBytes = 10 * 1024 * 1024;

  const reload = async () => {
    if (!isSupabaseConfigured) {
      setPosts(MOCK_POSTS);
      return;
    }
    if (!activeStoreId) {
      setPosts([]);
      return;
    }
    try {
      const data = await postsService.listByStore(activeStoreId);
      setPosts(data);
    } catch {
      addNotification('読み込みエラー', 'カレンダー用の投稿取得に失敗しました。', 'ERROR');
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStoreId]);

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
    return posts.filter(post => {
      const targetDate = post.scheduledDate || post.publishedDate;
      if (!targetDate || !isSameDay(targetDate, day)) return false;
      const platforms = post.platforms || [];
      if (filterPlatform !== 'ALL' && !platforms.includes(filterPlatform)) return false;
      return true;
    });
  };

  const handleDateClick = (date: Date) => {
    const now = new Date();
    const base = new Date(date);
    base.setHours(now.getHours(), now.getMinutes(), 0, 0);
    setCreateDateTime(toDatetimeLocalValue(base));
    setCreateContent('');
    setCreatePlatforms([]);
    setCreateImages([]);
    setCreateImagePreviewUrls([]);
    setAiTopic('');
    setAiTone('親しみやすい');
    setIsCreateModalOpen(true);
  };

  const statusColor = (post: Post) => {
    if (post.approvalStatus === 'PENDING') {
      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800';
    }
    if (post.approvalStatus === 'REJECTED') {
      return 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800';
    }
    const status = post.status;
    switch (status) {
      case PostStatus.PUBLISHED: return 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800';
      case PostStatus.SCHEDULED: return 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
      case PostStatus.DRAFT: return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600';
      case PostStatus.FAILED: return 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800';
      default: return 'bg-gray-100';
    }
  };

  const togglePlatform = (platform: SocialPlatform) => {
    setCreatePlatforms((prev) => (prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]));
  };

  const processFiles = (files: File[]) => {
    const accepted: File[] = [];
    files.forEach((file) => {
      if (file.size > maxFileSizeBytes) {
        addNotification('ファイルサイズ超過', '10MB以下の画像を選んでください。', 'WARNING');
        return;
      }
      accepted.push(file);
    });
    if (accepted.length === 0) return;
    setCreateImages((prev) => [...prev, ...accepted]);
    const urls = accepted.map((file) => URL.createObjectURL(file));
    setCreateImagePreviewUrls((prev) => [...prev, ...urls]);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeImage = (index: number) => {
    setCreateImages((prev) => prev.filter((_, i) => i !== index));
    setCreateImagePreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerateContent = async () => {
    if (!geminiService.isConfigured()) {
      addNotification('AI未設定', 'GEMINI_API_KEY が未設定のため、AI生成は使えません。', 'WARNING');
      return;
    }
    if (!aiTopic.trim()) {
      addNotification('トピック未入力', 'トピックを入力してください。', 'WARNING');
      return;
    }
    setIsGenerating(true);
    const platformName = createPlatforms.length > 0 ? createPlatforms.join(', ') : 'SNS全般';
    try {
      const generatedText = await geminiService.generatePostCaption(aiTopic, platformName, aiTone);
      setCreateContent(generatedText);
      addNotification('AI生成完了', '投稿文を生成しました。', 'SUCCESS');
    } catch {
      addNotification('生成エラー', 'AIによる生成中にエラーが発生しました。', 'ERROR');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreatePost = async () => {
    if (!createDateTime) {
      addNotification('日時未入力', '投稿日時を入力してください。', 'WARNING');
      return;
    }
    if (createPlatforms.length === 0) {
      addNotification('投稿先未選択', '投稿先を1つ以上選択してください。', 'WARNING');
      return;
    }
    if (!createContent.trim()) {
      addNotification('内容未入力', '投稿内容を入力してください。', 'WARNING');
      return;
    }

    if (!isSupabaseConfigured) {
      addNotification('モック', 'Supabase未設定のため保存できません。', 'INFO');
      setIsCreateModalOpen(false);
      return;
    }

    if (!activeStoreId) {
      addNotification('店舗未設定', '店舗が未設定のため投稿を保存できません。', 'ERROR');
      return;
    }

    setIsSaving(true);
    try {
      const created = await postsService.create({
        storeId: activeStoreId,
        authorUserId: currentUser.id,
        content: createContent,
        platforms: createPlatforms,
        scheduledAt: new Date(createDateTime),
        approvalStatus: isApprovalRequester ? 'PENDING' : 'APPROVED',
      });

      if (createImages.length > 0) {
        try {
          const result = await postMediaService.uploadForPost({
            storeId: activeStoreId,
            postId: created.id,
            files: createImages,
          });
          if (result.failedCount > 0) {
            addNotification('画像アップロード一部失敗', `${result.failedCount}件の画像アップロードに失敗しました。`, 'WARNING');
          }
        } catch (error: any) {
          addNotification(
            '画像アップロード失敗',
            `投稿は保存されましたが、画像のアップロードに失敗しました。${error?.message ? `（${error.message}）` : ''}`,
            'WARNING'
          );
        }
      }

      addNotification(
        isApprovalRequester ? '承認申請を作成' : '予約作成完了',
        isApprovalRequester ? '承認待ちとしてカレンダーに追加しました。' : 'カレンダーに投稿を追加しました。',
        'SUCCESS'
      );
      setIsCreateModalOpen(false);
      await reload();
    } catch {
      addNotification('作成エラー', '投稿の作成に失敗しました。', 'ERROR');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`${PAGE_CONTAINER_CLASS} h-full flex flex-col`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className={PAGE_HEADER_TITLE_CLASS}>カレンダー</h1>
            <p className={PAGE_HEADER_DESCRIPTION_CLASS}>投稿予定と配信計画を管理します。</p>
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

        <div className={`flex-1 ${PAGE_CARD_CLASS} flex flex-col overflow-hidden`}>
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
                        className={`text-[10px] p-1.5 rounded-md border mb-1 truncate shadow-sm transition-transform hover:scale-[1.02] ${statusColor(post)}`}
                        title={post.content}
                        onClick={(e) => {
                            e.stopPropagation();
                            setDetailPost(post);
                        }}
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          {post.approvalStatus === 'PENDING' ? <AlertCircle size={10} /> : post.status === PostStatus.PUBLISHED ? <CheckCircle size={10} /> : <Clock size={10} />}
                          <span className="truncate font-bold">{formatTime(post.scheduledDate || post.publishedDate || new Date())}</span>
                          <div className="flex gap-0.5 ml-auto">
                             {(post.platforms || []).map(p => (
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

      {isCreateModalOpen && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="font-bold text-gray-900 dark:text-white">この日の投稿を作成</div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSaving}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300 disabled:opacity-60"
                aria-label="閉じる"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">投稿日時</label>
                <input
                  type="datetime-local"
                  value={createDateTime}
                  onChange={(e) => setCreateDateTime(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">投稿先</label>
                <div className="flex flex-wrap gap-2">
                  {MOCK_ACCOUNTS.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => togglePlatform(account.platform)}
                      className={`px-3 py-2 rounded-full text-xs font-bold border transition-all ${
                        createPlatforms.includes(account.platform)
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {account.platform}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">画像</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-bold text-gray-600 dark:text-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                    <ImageIcon size={16} />
                    画像を選択
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} />
                  </label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">PNG, JPG (Max 10MB)</span>
                </div>
                <div
                  className={`mt-3 rounded-xl border-2 border-dashed p-4 text-center text-xs transition-colors ${
                    isDragging
                      ? 'border-primary-500 bg-primary-50/60 text-primary-700'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  クリックまたはドラッグ＆ドロップで画像を追加
                </div>
                {createImagePreviewUrls.length > 0 && (
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {createImagePreviewUrls.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                        <img src={url} alt="preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">投稿内容</label>
                <textarea
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  rows={5}
                  className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none dark:text-white"
                  placeholder="投稿内容を入力してください"
                />
              </div>

              <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200">AIで文章を作成</div>
                  <button
                    type="button"
                    onClick={handleGenerateContent}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
                  >
                    {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                    生成
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">トピック</label>
                    <input
                      type="text"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-2 text-sm"
                      placeholder="例: 新メニューのお知らせ"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">トーン</label>
                    <select
                      value={aiTone}
                      onChange={(e) => setAiTone(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-2 text-sm"
                    >
                      <option value="親しみやすい">親しみやすい（絵文字多め）</option>
                      <option value="フォーマル">フォーマル（ビジネス向け）</option>
                      <option value="情熱的">情熱的・エネルギッシュ</option>
                      <option value="ミニマル">ミニマル（短く簡潔に）</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-bold rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleCreatePost()}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-bold rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-70"
              >
                {isSaving ? '保存中...' : '予約投稿を作成'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {detailPost && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="font-bold text-gray-900 dark:text-white">投稿詳細</div>
              <button
                type="button"
                onClick={() => setDetailPost(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-300"
                aria-label="閉じる"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm text-gray-700 dark:text-gray-200">
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">ステータス</div>
                <div>{detailPost.status}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">日時</div>
                <div>
                  {detailPost.scheduledDate
                    ? formatDate(detailPost.scheduledDate)
                    : detailPost.publishedDate
                      ? formatDate(detailPost.publishedDate)
                      : '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">投稿先</div>
                <div className="flex gap-2 flex-wrap">
                  {(detailPost.platforms || []).map((p) => (
                    <span key={p} className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">内容</div>
                <div className="whitespace-pre-wrap">{detailPost.content}</div>
              </div>
              {(detailPost.imageUrls || []).length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">画像</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(detailPost.imageUrls || []).map((url, idx) => (
                      <img key={idx} src={url} className="w-full h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
};
