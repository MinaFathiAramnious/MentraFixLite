// pages/purchases_stock.js

window.Module_PurchasesAndStock = function({ userId, showToast, setActiveModule }) {
    const { useState, useEffect, useRef } = React;
    
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    
    // 1. البيانات والإحصائيات
    const [stats, setStats] = useState({ total_purchases: 0, items_in: 0, items_out: 0 });
    const [movements, setMovements] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total_records: 0 });
    
    // 2. فلاتر البحث والتواريخ للجدول
    const [tableSearch, setTableSearch] = useState('');
    const tableSearchTimeoutRef = useRef(null);

    const getFirstDayOfMonth = () => {
        const d = new Date();
        d.setDate(1);
        return d.toISOString().split('T')[0];
    };

    const [dateFilter, setDateFilter] = useState({ 
        from: getFirstDayOfMonth(),
        to: new Date().toISOString().split('T')[0]
    });

    // 3. حالة نافذة المشتريات
    const [showPurchaseModal, setShowPurchaseModal] = useState(false);
    
    // 4. حالات السيرش في فورم الشراء
    const [searchKeyword, setSearchKeyword] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedPart, setSelectedPart] = useState(null);
    const purchaseSearchTimeoutRef = useRef(null);

    const [purchaseForm, setPurchaseForm] = useState({ quantity: 1, unit_price: '', add_to_expenses: true });

    // ==========================================
    // دوال قاعدة البيانات المحلية (Dexie.js)
    // ==========================================
    
    const fetchStats = async () => {
        try {
            const currentMonth = new Date().toISOString().slice(0, 7); // يرجع "YYYY-MM"
            
            // جلب حركات المخزن للشهر الحالي
            const allMovements = await window.db.stock_movements.toArray();
            const monthMovements = allMovements.filter(m => m.created_at.startsWith(currentMonth));
            
            let inQty = 0;
            let outQty = 0;
            let totalPurchases = 0;

            monthMovements.forEach(m => {
                const isAdd = m.movement_type.includes('وارد') || m.movement_type.includes('شراء') || m.movement_type.includes('إضافة') || m.movement_type.includes('افتتاحي');
                
                if (isAdd) {
                    inQty += Number(m.quantity);
                    if(m.total_cost) totalPurchases += Number(m.total_cost);
                } else {
                    outQty += Number(m.quantity);
                }
            });

            // لو أردنا دقة أكبر لتكلفة الشراء، نجمعها من جدول المصروفات (مشتريات بضاعة)
            const expenses = await window.db.expenses.toArray();
            const monthPurchases = expenses
                .filter(e => e.date.startsWith(currentMonth) && e.expense_type === 'مشتريات بضاعة')
                .reduce((sum, e) => sum + Number(e.amount), 0);

            setStats({
                total_purchases: monthPurchases > 0 ? monthPurchases : totalPurchases,
                items_in: inQty,
                items_out: outQty
            });
        } catch (e) { console.error("Error fetching stats:", e); }
    };

    const fetchMovements = async (page = 1, searchStr = tableSearch) => {
        setIsLoading(true);
        try {
            // جلب الحركات وعكسها (الأحدث أولاً)
            let rawMovements = await window.db.stock_movements.reverse().toArray();
            
            // 1. فلتر التاريخ
            rawMovements = rawMovements.filter(m => {
                const mDate = m.created_at.split('T')[0];
                return mDate >= dateFilter.from && mDate <= dateFilter.to;
            });

            // 2. دمج بيانات القطع والمستخدمين (Join)
            let enrichedMovements = [];
            for (let m of rawMovements) {
                const part = await window.db.inventory_parts.get(m.part_id);
                const user = m.user_id ? await window.db.users.get(m.user_id) : null;
                
                enrichedMovements.push({
                    ...m,
                    part_name: part ? part.part_name : 'قطعة محذوفة',
                    sku: part && part.sku ? part.sku : '',
                    user_name: user ? user.name : 'النظام',
                    is_in: m.movement_type.includes('وارد') || m.movement_type.includes('شراء') || m.movement_type.includes('إضافة') || m.movement_type.includes('افتتاحي')
                });
            }

            // 3. فلتر البحث النصي
            if (searchStr.trim() !== '') {
                const lowerSearch = searchStr.toLowerCase();
                enrichedMovements = enrichedMovements.filter(m => 
                    m.part_name.toLowerCase().includes(lowerSearch) || 
                    m.sku.toLowerCase().includes(lowerSearch) ||
                    m.movement_type.toLowerCase().includes(lowerSearch)
                );
            }

            // 4. التقليب (Pagination)
            const perPage = 3;
            const total = enrichedMovements.length;
            const last_page = Math.ceil(total / perPage) || 1;
            const paginatedItems = enrichedMovements.slice((page - 1) * perPage, page * perPage);

            setMovements(paginatedItems);
            setPagination({ current_page: page, last_page, total_records: total });
        } catch (error) { 
            showToast("حدث خطأ في قراءة الحركات", "error"); 
            console.error(error);
        } finally { 
            setIsLoading(false); 
        }
    };

    useEffect(() => {
        fetchStats();
        fetchMovements(1);
    }, []); 

    const applyDateFilter = () => fetchMovements(1, tableSearch);

    const handleTableSearchChange = (e) => {
        const val = e.target.value;
        setTableSearch(val);
        if (tableSearchTimeoutRef.current) clearTimeout(tableSearchTimeoutRef.current);
        tableSearchTimeoutRef.current = setTimeout(() => {
            fetchMovements(1, val);
        }, 400);
    };

    // ==========================================
    // سيرش نافذة الشراء (محلي)
    // ==========================================
    const handlePurchaseSearch = async (e) => {
        const val = e.target.value;
        setSearchKeyword(val);
        setSelectedPart(null); 
        
        if (purchaseSearchTimeoutRef.current) clearTimeout(purchaseSearchTimeoutRef.current);
        if(val.length < 1) { setSearchResults([]); return; }

        purchaseSearchTimeoutRef.current = setTimeout(async () => {
            try {
                const lowerVal = val.toLowerCase();
                const parts = await window.db.inventory_parts.filter(p => 
                    p.part_name.toLowerCase().includes(lowerVal) || 
                    (p.sku && p.sku.toLowerCase().includes(lowerVal))
                ).toArray();
                
                setSearchResults(parts.slice(0, 8)); // عرض أول 8 نتائج فقط
            } catch (error) { console.error("Search error", error); }
        }, 300);
    };

    const selectPart = (part) => {
        setSelectedPart(part);
        setSearchKeyword(part.part_name);
        setSearchResults([]);
        setPurchaseForm({ ...purchaseForm, unit_price: part.purchase_price || '' }); 
    };

    const handlePurchaseSubmit = async (e) => {
        e.preventDefault();
        if(!selectedPart) { showToast("الرجاء اختيار القطعة أولاً", "error"); return; }
        setIsUpdating(true);
        try {
            const qty = Number(purchaseForm.quantity);
            const price = Number(purchaseForm.unit_price);
            const totalCost = qty * price;
            const now = new Date().toISOString();

            // Transaction لضمان الحفظ في كل الجداول بشكل صحيح
            await window.db.transaction('rw', window.db.inventory_parts, window.db.stock_movements, window.db.expenses, async () => {
                
                // 1. تحديث رصيد القطعة وسعر الشراء الأخير
                const part = await window.db.inventory_parts.get(selectedPart.id);
                await window.db.inventory_parts.update(part.id, {
                    stock_quantity: Number(part.stock_quantity) + qty,
                    purchase_price: price, // تحديث التكلفة للقطعة
                    updated_at: now
                });

                // 2. تسجيل الحركة
                await window.db.stock_movements.add({
                    part_id: part.id,
                    user_id: userId,
                    movement_type: 'شراء بضاعة (وارد)',
                    quantity: qty,
                    total_cost: totalCost, // حفظ التكلفة هنا كمرجع
                    created_at: now
                });

                // 3. التسجيل في المصروفات (اختياري)
                if (purchaseForm.add_to_expenses) {
                    await window.db.expenses.add({
                        expense_type: 'مشتريات بضاعة',
                        amount: totalCost,
                        date: now.split('T')[0],
                        description: `شراء قطعة: ${part.part_name} - كمية: ${qty}`
                    });
                }
            });

            showToast("تم توريد البضاعة بنجاح", "success");
            setShowPurchaseModal(false);
            setSearchKeyword('');
            setSelectedPart(null);
            fetchStats();
            fetchMovements(1, tableSearch);
            
        } catch (e) { 
            console.error(e);
            showToast("حدث خطأ أثناء حفظ الشراء", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    return (
        <div className="space-y-6 relative pb-10">
            
            {/* الهيدر */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center text-cyan-600"><i className="fa-solid fa-cart-flatbed"></i></div>
                        المشتريات وحركة المخزن
                    </h2>
                    <p className="text-slate-500 text-sm font-bold mt-2">سجل مشتريات البضاعة (الوارد) والمسحوبات لأوامر الشغل (المنصرف).</p>
                </div>
                <button onClick={() => { setShowPurchaseModal(true); setSelectedPart(null); setSearchKeyword(''); }} className="bg-gradient-to-l from-emerald-500 to-emerald-600 hover:opacity-90 text-white shadow-lg shadow-emerald-500/30 px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto">
                    <i className="fa-solid fa-truck-ramp-box"></i> شراء وتوريد بضاعة
                </button>
            </div>

            {/* الإحصائيات الشاملة */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-[#0B1120] to-slate-800 p-5 rounded-2xl text-white shadow-lg relative overflow-hidden flex items-center justify-between border border-slate-700">
                    <i className="fa-solid fa-money-bill-transfer absolute -left-2 -bottom-2 text-7xl opacity-10"></i>
                    <div className="relative z-10">
                        <p className="text-slate-400 text-xs font-bold mb-1">تكلفة الشراء (للشهر الحالي)</p>
                        <h3 className="text-3xl font-black text-emerald-400">{stats.total_purchases.toLocaleString()} <span className="text-sm font-bold">ج.م</span></h3>
                    </div>
                    <div className="w-12 h-12 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center relative z-10"><i className="fa-solid fa-file-invoice-dollar text-xl text-emerald-300"></i></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-emerald-500 text-xs font-bold mb-1">إجمالي الوارد (الشهر)</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.items_in} <span className="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">قطعة</span></h3>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-arrow-down text-xl"></i></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-rose-500 text-xs font-bold mb-1">المنصرف لأوامر الشغل</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.items_out} <span className="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">قطعة</span></h3>
                    </div>
                    <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-arrow-up text-xl"></i></div>
                </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative flex flex-col">
                
                {/* شريط البحث والفلاتر */}
                <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row gap-4 items-center justify-between shrink-0">
                    
                    {/* البحث بالاسم */}
                    <div className="relative w-full lg:w-1/3">
                        <input type="text" placeholder="بحث باسم القطعة أو الكود..." className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-cyan-500 transition-all font-bold shadow-sm" value={tableSearch} onChange={handleTableSearchChange} />
                        <i className="fa-solid fa-magnifying-glass absolute top-1/2 right-4 -translate-y-1/2 text-slate-400"></i>
                    </div>

                    {/* فلتر التاريخ */}
                    <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 w-full lg:w-auto bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-slate-500 px-2"><i className="fa-solid fa-calendar-days text-cyan-500 mr-1"></i> من</span>
                            <input type="date" className="bg-slate-50 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 border border-transparent focus:border-cyan-300" value={dateFilter.from} onChange={(e) => setDateFilter({...dateFilter, from: e.target.value})} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-slate-500">إلى</span>
                            <input type="date" className="bg-slate-50 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 border border-transparent focus:border-cyan-300" value={dateFilter.to} onChange={(e) => setDateFilter({...dateFilter, to: e.target.value})} />
                        </div>
                        <button onClick={applyDateFilter} className="bg-cyan-50 text-cyan-600 hover:bg-cyan-500 hover:text-white px-3 py-1.5 rounded-lg font-bold text-xs transition-colors border border-cyan-100 hover:border-cyan-500 ml-1">تطبيق</button>
                    </div>
                </div>

                {isLoading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center mt-20">
                        <div className="w-12 h-12 border-4 border-cyan-100 border-t-cyan-500 rounded-full animate-spin"></div>
                    </div>
                )}

                <div className="overflow-x-auto hide-scrollbar flex-1">
                    <table className="w-full text-right text-sm min-w-[700px]">
                        <thead className="bg-slate-50/80 text-slate-500 font-bold border-b border-slate-100">
                            <tr>
                                <th className="p-4 whitespace-nowrap">التاريخ والوقت</th>
                                <th className="p-4 whitespace-nowrap">القطعة (الكود)</th>
                                <th className="p-4 whitespace-nowrap">نوع الحركة (البيان)</th>
                                <th className="p-4 whitespace-nowrap text-center">الكمية</th>
                                <th className="p-4 whitespace-nowrap">المسؤول</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {movements?.length > 0 ? movements.map((mov, index) => {
                                const dateTime = mov.created_at.split('T');
                                const date = dateTime[0];
                                const time = dateTime[1] ? dateTime[1].substring(0, 5) : '';
                                
                                return (
                                <tr key={mov.id || index} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-4">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-slate-600" dir="ltr">{date}</span>
                                            {time && <span className="text-[10px] font-bold text-slate-400 mt-0.5 flex items-center gap-1"><i className="fa-regular fa-clock"></i> {time}</span>}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <p className="font-bold text-slate-800">{mov.part_name}</p>
                                        {mov.sku && <span className="text-[10px] font-bold text-slate-400 mt-1 tracking-wider font-mono bg-slate-100 inline-block px-1.5 py-0.5 rounded" dir="ltr"><i className="fa-solid fa-barcode mr-1"></i>{mov.sku}</span>}
                                    </td>
                                    <td className="p-4">
                                        {mov.is_in ? (
                                            <div>
                                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-lg text-[11px] font-black inline-flex items-center gap-1"><i className="fa-solid fa-arrow-down"></i> {mov.movement_type}</span>
                                                {mov.total_cost > 0 && <p className="text-[10px] font-bold text-slate-500 mt-1.5 bg-slate-50 inline-block px-2 py-0.5 rounded">التكلفة: <span className="text-slate-700">{Number(mov.total_cost).toLocaleString()} ج.م</span></p>}
                                            </div>
                                        ) : (
                                            <div>
                                                <span className="bg-rose-50 text-rose-700 border border-rose-100 px-2.5 py-1 rounded-lg text-[11px] font-black inline-flex items-center gap-1"><i className="fa-solid fa-arrow-up"></i> {mov.movement_type}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded-xl font-black text-lg ${mov.is_in ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                            <span className="text-[10px] mr-1 opacity-60">{mov.is_in ? '+' : '-'}</span>{mov.quantity}
                                        </div>
                                    </td>
                                    <td className="p-4 text-[11px] font-bold text-slate-500"><i className="fa-solid fa-user-tie mr-1 text-cyan-500 bg-cyan-50 p-1.5 rounded-lg"></i> {mov.user_name}</td>
                                </tr>
                            )}) : <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-bold"><div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-clipboard-list text-2xl"></i></div>لا توجد حركات مخزن مسجلة.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {pagination.total_records > 0 && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                        <span className="text-[11px] font-bold text-slate-500">صفحة {pagination.current_page} من {pagination.last_page} <span className="mr-2 px-2 py-0.5 bg-white rounded-md border border-slate-200">إجمالي: {pagination.total_records}</span></span>
                        <div className="flex gap-2">
                            <button onClick={() => fetchMovements(pagination.current_page + 1, tableSearch)} disabled={pagination.current_page === pagination.last_page || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-right text-xs"></i></button>
                            <button onClick={() => fetchMovements(pagination.current_page - 1, tableSearch)} disabled={pagination.current_page === 1 || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-left text-xs"></i></button>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================== */}
            {/* إعلان النسخة المدفوعة */}
            {/* ========================================== */}
            <div className="mt-8 bg-[#0B1120] rounded-3xl p-6 md:p-8 border border-emerald-500/30 shadow-[0_10px_40px_rgba(16,185,129,0.15)] relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-emerald-500/60 transition-all">
                <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/4 pointer-events-none group-hover:bg-emerald-500/20 transition-all duration-500"></div>
                <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 translate-x-1/4 pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                
                <div className="relative z-10 flex items-center gap-5">
                    <div className="hidden sm:flex w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 items-center justify-center text-white text-3xl shadow-lg shadow-emerald-500/25 shrink-0">
                        <i className="fa-solid fa-handshake"></i>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">Pro Version</span>
                            <h3 className="text-xl md:text-2xl font-black text-white">إدارة احترافية للموردين والمدفوعات!</h3>
                        </div>
                        <p className="text-slate-400 text-xs md:text-sm font-bold mt-2 max-w-xl leading-relaxed">
                            في النسخة المدفوعة، يمكنك تسجيل فواتير المشتريات الآجلة، متابعة كشوف حسابات الموردين، إدارة المرتجعات، وتتبع الباركود (Barcode) لكل قطعة بسهولة عبر الموبايل.
                        </p>
                    </div>
                </div>

                <div className="relative z-10 w-full md:w-auto shrink-0 flex flex-col sm:flex-row gap-3">
                    <a href="https://wa.me/201211934816" target="_blank" className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white px-6 py-3 rounded-xl font-bold transition-transform hover:scale-105 shadow-lg shadow-[#25D366]/20">
                        <i className="fa-brands fa-whatsapp text-lg"></i>
                        <span dir="ltr">01211934816</span>
                    </a>
                    <a href="tel:01211934816" className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-6 py-3 rounded-xl font-bold transition-all">
                        <i className="fa-solid fa-phone text-sm"></i>
                        <span>اتصل بنا</span>
                    </a>
                </div>
            </div>

            {/* ========================================== */}
            {/* Modal نافذة الشراء (متوافقة مع الموبايل) */}
            {/* ========================================== */}
            {showPurchaseModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPurchaseModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md z-10 overflow-hidden animate-view border border-slate-100 flex flex-col max-h-[90vh]">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-emerald-50/50 shrink-0">
                            <h3 className="text-lg font-black text-emerald-800 flex items-center gap-2"><i className="fa-solid fa-truck-ramp-box text-emerald-500"></i> شراء وتوريد بضاعة</h3>
                            <button onClick={() => setShowPurchaseModal(false)} className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto">
                            <form id="purchaseForm" onSubmit={handlePurchaseSubmit} className="space-y-6">
                                {/* البحث الديناميكي */}
                                <div className="relative">
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">ابحث عن القطعة (المسجلة مسبقاً) <span className="text-rose-500">*</span></label>
                                    <div className="relative">
                                        <input type="text" placeholder="اسم القطعة أو الكود..." className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-slate-50 focus:bg-white transition-all pr-10" value={searchKeyword} onChange={handlePurchaseSearch} required={!selectedPart} disabled={!!selectedPart} />
                                        <i className="fa-solid fa-search absolute top-1/2 right-4 -translate-y-1/2 text-slate-400"></i>
                                    </div>
                                    
                                    {/* قائمة النتائج */}
                                    {searchResults.length > 0 && !selectedPart && (
                                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-56 overflow-y-auto divide-y divide-slate-50">
                                            {searchResults.map(part => (
                                                <div key={part.id} onClick={() => selectPart(part)} className="p-3 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer flex justify-between items-center transition-colors group">
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-800 group-hover:text-emerald-700">{part.part_name}</p>
                                                        {part.sku && <p className="text-[10px] text-slate-400 font-mono tracking-wider mt-1">{part.sku}</p>}
                                                    </div>
                                                    <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg group-hover:bg-emerald-100 group-hover:text-emerald-600 border border-slate-200 group-hover:border-emerald-200">الرصيد: {part.stock_quantity}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* القطعة المختارة */}
                                {selectedPart && (
                                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 flex items-center justify-between gap-3 animate-view">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/30"><i className="fa-solid fa-check"></i></div>
                                            <div>
                                                <p className="text-[10px] font-bold text-emerald-600 mb-0.5">تم اختيار القطعة:</p>
                                                <p className="text-sm font-black text-emerald-900 leading-tight">{selectedPart.part_name}</p>
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => {setSelectedPart(null); setSearchKeyword('');}} className="w-8 h-8 rounded-full bg-white border border-emerald-200 text-rose-500 hover:bg-rose-50 flex items-center justify-center shadow-sm"><i className="fa-solid fa-rotate-left text-xs"></i></button>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">الكمية المشتراة <span className="text-rose-500">*</span></label>
                                        <input type="number" min="1" required className="w-full border border-slate-200 rounded-xl px-3 py-3 text-xl text-center font-black text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-emerald-500 transition-all" value={purchaseForm.quantity} onChange={(e) => setPurchaseForm({...purchaseForm, quantity: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر الوحدة <span className="text-rose-500">*</span></label>
                                        <div className="relative">
                                            <input type="number" step="0.01" min="0" required className="w-full border border-emerald-200 rounded-xl px-3 py-3 text-xl text-center font-black text-emerald-700 bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all" value={purchaseForm.unit_price} onChange={(e) => setPurchaseForm({...purchaseForm, unit_price: e.target.value})} />
                                        </div>
                                    </div>
                                </div>
                                
                                <label className="flex items-start gap-3 cursor-pointer bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-emerald-200 transition-colors">
                                    <div className="relative flex items-center justify-center mt-0.5">
                                        <input type="checkbox" className="w-5 h-5 accent-emerald-600 rounded cursor-pointer" checked={purchaseForm.add_to_expenses} onChange={(e) => setPurchaseForm({...purchaseForm, add_to_expenses: e.target.checked})} />
                                    </div>
                                    <div>
                                        <span className="block text-sm font-bold text-slate-800">تسجيل كمصروف تلقائي في الحسابات</span>
                                        <span className="block text-[10px] text-slate-500 font-semibold mt-1">سيتم خصم إجمالي التكلفة من أرباحك في التقارير.</span>
                                    </div>
                                </label>
                            </form>
                        </div>
                        
                        <div className="p-5 border-t border-slate-100 bg-slate-50 shrink-0">
                            <button type="submit" form="purchaseForm" disabled={isUpdating || !selectedPart} className="w-full bg-gradient-to-l from-emerald-500 to-emerald-600 hover:opacity-90 text-white py-3.5 rounded-xl font-black transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-500/30 text-base">
                                {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check-double"></i>} تأكيد توريد البضاعة
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};