window.Module_Main = function({ centerId, userId, showToast, setActiveModule }) {
    const { useState, useEffect } = React;

    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState({ revenue: 0, active_jobs: 0, completed_jobs: 0, total_customers: 0 });
    const [recentOrders, setRecentOrders] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1 });
    
    // جلب اسم المستخدم من الجلسة
    const sessionStr = localStorage.getItem('MentraFix_Session');
    const sessionData = sessionStr ? JSON.parse(sessionStr) : { name: 'يا باشمهندس' };

    // ==========================================
    // دالة جلب البيانات من قاعدة البيانات المحلية (Dexie)
    // ==========================================
    const fetchDashboardData = async (page = 1) => {
        setIsLoading(true);
        try {
            // 1. حساب الإحصائيات (Stats)
            const payments = await window.db.payments.toArray();
            const revenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

            const allRequests = await window.db.maintenance_requests.toArray();
            
            // إصلاح وحل مشكلة الأوامر النشطة:
            // الأوامر النشطة هي أي أمر (لم يكتمل، ولم يسلم، ولم يلغى)
            const closedStatuses = ['مكتمل', 'تم التسليم', 'ملغاة'];
            const active_jobs = allRequests.filter(r => {
                const currentStatus = r.status ? r.status.trim() : '';
                return !closedStatuses.includes(currentStatus);
            }).length;
            
            // الأوامر المكتملة
            const completed_jobs = allRequests.filter(r => {
                const currentStatus = r.status ? r.status.trim() : '';
                return ['مكتمل', 'تم التسليم'].includes(currentStatus);
            }).length;

            const total_customers = await window.db.customers.count();

            setStats({ revenue, active_jobs, completed_jobs, total_customers });

            // 2. جلب أحدث أوامر الشغل مع (Pagination)
            const perPage = 3;
            // ترتيب الأوامر من الأحدث للأقدم
            let sortedRequests = allRequests.sort((a, b) => b.id - a.id);
            
            const total = sortedRequests.length;
            const last_page = Math.ceil(total / perPage) || 1;
            
            const paginatedRequests = sortedRequests.slice((page - 1) * perPage, page * perPage);

            // دمج بيانات العميل والجهاز لكل أمر شغل
            for (let req of paginatedRequests) {
                if (req.customer_id) {
                    const cust = await window.db.customers.get(Number(req.customer_id));
                    req.customer_name = cust ? cust.name : 'عميل غير مسجل';
                } else {
                    req.customer_name = 'عميل غير مسجل';
                }

                if (req.device_id) {
                    const dev = await window.db.devices.get(Number(req.device_id));
                    req.device_type = dev ? dev.device_type : 'غير محدد';
                } else {
                    req.device_type = 'غير محدد';
                }
            }

            setRecentOrders(paginatedRequests);
            setPagination({ current_page: page, last_page });

        } catch (error) {
            console.error(error);
            showToast("حدث خطأ في تجميع بيانات اللوحة", "error");
        } finally {
            setIsLoading(false);
        }
    };

    // جلب البيانات عند تحميل الشاشة
    useEffect(() => {
        fetchDashboardData(pagination.current_page);
    }, []);

    // دالة لتغيير الصفحة (Pagination)
    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= pagination.last_page) {
            fetchDashboardData(newPage);
        }
    };

    // دالة مساعدة لتنسيق التواريخ
    const safeFormatDate = (dateString) => {
        if (!dateString) return '-';
        try { return String(dateString).split('T')[0].split(' ')[0]; } 
        catch (e) { return '-'; }
    };

    // دالة مساعدة لتنسيق حالة الطلب باللغة العربية
    const getStatusStyle = (status) => {
        const cleanStatus = status ? status.trim() : '';
        const styles = {
            'قيد الانتظار': { color: 'bg-slate-100 text-slate-700', icon: 'fa-clock' },
            'جاري الفحص': { color: 'bg-blue-100 text-blue-700', icon: 'fa-magnifying-glass' },
            'بانتظار موافقة العميل': { color: 'bg-yellow-100 text-yellow-700', icon: 'fa-phone-volume' },
            'جاري الصيانة': { color: 'bg-cyan-100 text-cyan-700', icon: 'fa-screwdriver-wrench' },
            'بانتظار قطع غيار': { color: 'bg-orange-100 text-orange-700', icon: 'fa-box-open' },
            'مكتمل': { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-check-double' },
            'تم التسليم': { color: 'bg-purple-100 text-purple-700', icon: 'fa-handshake' },
            'ملغاة': { color: 'bg-rose-100 text-rose-700', icon: 'fa-ban' }
        };
        const st = styles[cleanStatus] || { color: 'bg-slate-100 text-slate-700', icon: 'fa-circle' };
        return { ...st, text: cleanStatus || 'غير محدد' };
    };

    if (isLoading && recentOrders.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <i className="fas fa-circle-notch fa-spin text-4xl text-cyan-500 mb-4"></i>
                <p className="font-bold">جاري تجميع بيانات اللوحة...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 relative pb-10">
            
            {/* 1. الترحيب والاختصارات السريعة */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">مرحباً بعودتك، {sessionData.name.split(' ')[0]} 👋</h2>
                    <p className="text-slate-500 text-sm font-bold mt-1">إليك ملخص سريع لما يحدث في مركز الصيانة الخاص بك اليوم.</p>
                </div>
                
                {/* أزرار التنقل السريع */}
                <div className="flex gap-2 w-full md:w-auto">
                    <button onClick={() => setActiveModule('requests')} className="flex-1 md:flex-none bg-gradient-to-l from-cyan-500 to-blue-600 hover:opacity-90 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg shadow-cyan-500/30 flex items-center justify-center gap-2">
                        <i className="fa-solid fa-plus"></i> أمر شغل جديد
                    </button>
                    <button onClick={() => setActiveModule('customers')} className="flex-1 md:flex-none bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2">
                        <i className="fa-solid fa-user-plus"></i> عميل جديد
                    </button>
                    <button onClick={() => setActiveModule('finances')} className="flex-1 md:flex-none bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 hidden sm:flex">
                        <i className="fa-solid fa-file-invoice-dollar"></i> الحسابات
                    </button>
                </div>
            </div>

            {/* 2. الإحصائيات السريعة (KPIs) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-[#0B1120] to-slate-800 p-6 rounded-3xl text-white shadow-lg border border-slate-700 relative overflow-hidden">
                    <i className="fa-solid fa-wallet absolute -left-4 -bottom-4 text-7xl opacity-10"></i>
                    <p className="text-slate-400 text-xs font-bold mb-1">إجمالي الإيرادات المُحصلة</p>
                    <h3 className="text-3xl font-black text-cyan-400">{stats.revenue.toLocaleString()} <span className="text-xs font-bold opacity-70">ج.م</span></h3>
                </div>
                
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold mb-1">الأوامر النشطة</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.active_jobs}</h3>
                    </div>
                    <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-xl">
                        <i className="fa-solid fa-tools"></i>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold mb-1">الأوامر المكتملة</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.completed_jobs}</h3>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center text-xl">
                        <i className="fa-solid fa-check-circle"></i>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold mb-1">إجمالي العملاء</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.total_customers}</h3>
                    </div>
                    <div className="w-12 h-12 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center text-xl">
                        <i className="fa-solid fa-users"></i>
                    </div>
                </div>
            </div>

            {/* 3. جدول أحدث الطلبات (مع Pagination) */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="font-black text-slate-800 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center text-cyan-600"><i className="fa-solid fa-clock-rotate-left"></i></div>
                        أحدث أوامر الشغل
                    </h3>
                    <button onClick={() => fetchDashboardData(pagination.current_page)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-cyan-600 hover:border-cyan-200 transition-colors shadow-sm flex items-center justify-center" title="تحديث البيانات">
                        <i className={`fa-solid fa-rotate-right ${isLoading ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
                
                <div className="overflow-x-auto hide-scrollbar">
                    <table className="w-full text-right text-sm min-w-[800px]">
                        <thead className="bg-white border-b border-slate-100 text-slate-500 font-bold text-xs">
                            <tr>
                                <th className="p-4 whitespace-nowrap">رقم الطلب</th>
                                <th className="p-4 whitespace-nowrap">اسم العميل</th>
                                <th className="p-4 whitespace-nowrap">نوع الجهاز</th>
                                <th className="p-4 whitespace-nowrap text-center">حالة الصيانة</th>
                                <th className="p-4 whitespace-nowrap text-left">تاريخ الاستلام</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {recentOrders.length > 0 ? recentOrders.map((order) => {
                                const statusUI = getStatusStyle(order.status);
                                return (
                                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="p-4 font-black text-slate-700 tracking-wider font-mono">#{String(order.id).padStart(4, '0')}</td>
                                        <td className="p-4 font-bold text-slate-800">{order.customer_name}</td>
                                        <td className="p-4 font-bold text-slate-600">{order.device_type}</td>
                                        <td className="p-4 text-center">
                                            <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black flex items-center gap-1.5 w-max mx-auto shadow-sm border border-slate-100/50 ${statusUI.color}`}>
                                                <i className={`fa-solid ${statusUI.icon}`}></i> {statusUI.text}
                                            </span>
                                        </td>
                                        <td className="p-4 font-bold text-slate-400 text-xs text-left" dir="ltr">
                                            {safeFormatDate(order.receipt_date || order.created_at)}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan="5" className="p-12 text-center text-slate-400 font-bold">
                                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-folder-open text-2xl"></i></div>
                                        لا توجد أوامر شغل مسجلة في المركز حتى الآن.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* 4. نظام التقليب (Pagination) */}
                {pagination.last_page > 1 && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <span className="text-[11px] font-bold text-slate-500">
                            صفحة {pagination.current_page} من {pagination.last_page}
                        </span>
                        
                        <div className="flex gap-2">
                            <button onClick={() => handlePageChange(pagination.current_page + 1)} disabled={pagination.current_page === pagination.last_page || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm">
                                <i className="fa-solid fa-chevron-right text-xs"></i>
                            </button>
                            <button onClick={() => handlePageChange(pagination.current_page - 1)} disabled={pagination.current_page === 1 || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm">
                                <i className="fa-solid fa-chevron-left text-xs"></i>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================== */}
            {/* إعلان النسخة المدفوعة (أسفل الصفحة) */}
            {/* ========================================== */}
            <div className="mt-8 bg-[#0B1120] rounded-3xl p-6 md:p-8 border border-cyan-500/30 shadow-[0_10px_40px_rgba(6,182,212,0.15)] relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-cyan-500/60 transition-all">
                {/* تأثيرات الإضاءة الخلفية */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-500"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4 pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                
                <div className="relative z-10 flex items-center gap-5">
                    <div className="hidden sm:flex w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 items-center justify-center text-white text-3xl shadow-lg shadow-cyan-500/25 shrink-0">
                        <i className="fa-solid fa-rocket"></i>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">Pro Version</span>
                            <h3 className="text-xl md:text-2xl font-black text-white">طور مركزك مع نسخة المنترا السحابية!</h3>
                        </div>
                        <p className="text-slate-400 text-xs md:text-sm font-bold mt-2 max-w-xl leading-relaxed">
                            احصل على صلاحيات مفتوحة، رسائل واتساب للعملاء تلقائياً، إمكانية العمل من الموبايل والكمبيوتر في نفس الوقت، حماية بياناتك سحابياً، وتقارير مالية متقدمة.
                        </p>
                    </div>
                </div>

                <div className="relative z-10 w-full md:w-auto shrink-0 flex flex-col sm:flex-row gap-3">
                    <a href="https://wa.me/201211934816" target="_blank" className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white px-6 py-3 rounded-xl font-bold transition-transform hover:scale-105 shadow-lg shadow-[#25D366]/20">
                        <i className="fa-brands fa-whatsapp text-lg"></i>
                        <span dir="ltr">01211934816</span>
                    </a>
                </div>
            </div>

        </div>
    );
};