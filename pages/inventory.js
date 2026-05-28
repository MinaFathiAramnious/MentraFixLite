// pages/inventory.js

window.Module_Inventory = function({ centerId, userId, showToast, setActiveModule }) {
    const { useState, useEffect, useRef } = React;
    
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    
    // 1. بيانات الجدول
    const [items, setItems] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [stats, setStats] = useState({ total_items: 0, total_value: 0, low_stock: 0 });
    
    // 2. حالة البحث
    const [searchText, setSearchText] = useState('');
    const searchTimeoutRef = useRef(null);

    // 3. حالة نافذة إضافة/تعديل صنف
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState('add');
    const initialFormState = { id: null, part_name: '', sku: '', brand: '', location_in_store: '', stock_quantity: '', purchase_price: '', selling_price: '' };
    const [formData, setFormData] = useState(initialFormState);

    // 4. حالة نافذة تسوية الرصيد السريعة
    const [showAdjustModal, setShowAdjustModal] = useState(false);
    const [adjustData, setAdjustData] = useState({ id: null, part_name: '', current_qty: 0, adjust_type: 'add', amount: 1 });

    // ==========================================
    // دوال قاعدة البيانات المحلية (Dexie.js)
    // ==========================================
    const fetchStats = async () => {
        try {
            // استخدام الاسم الصحيح للجدول: inventory_parts
            const allItems = await window.db.inventory_parts.toArray();
            
            let totalValue = 0;
            let lowStockCount = 0;

            allItems.forEach(item => {
                totalValue += (Number(item.purchase_price) || 0) * (Number(item.stock_quantity) || 0);
                if (Number(item.stock_quantity) <= 5) lowStockCount++;
            });

            setStats({
                total_items: allItems.length,
                total_value: totalValue,
                low_stock: lowStockCount
            });
        } catch (e) { console.error("Error fetching inventory stats", e); }
    };

    const fetchItems = async (page = 1, search = searchText) => {
        setIsLoading(true);
        try {
            // استخدام الاسم الصحيح للجدول: inventory_parts
            let allItems = await window.db.inventory_parts.reverse().toArray();
            
            if (search.trim() !== '') {
                const lowerSearch = search.toLowerCase();
                allItems = allItems.filter(item => 
                    item.part_name.toLowerCase().includes(lowerSearch) || 
                    (item.sku && item.sku.toLowerCase().includes(lowerSearch)) ||
                    (item.brand && item.brand.toLowerCase().includes(lowerSearch))
                );
            }

            const perPage = 3;
            const total = allItems.length;
            const last_page = Math.ceil(total / perPage) || 1;
            const paginatedItems = allItems.slice((page - 1) * perPage, page * perPage);

            setItems(paginatedItems);
            setPagination({ current_page: page, last_page, total });
        } catch (error) { 
            showToast("حدث خطأ في قراءة بيانات المخزن", "error"); 
            console.error("Fetch Items Error:", error);
        } finally { 
            setIsLoading(false); 
        }
    };

    useEffect(() => {
        fetchStats();
        fetchItems(1, '');
    }, []);

    const handleSearchChange = (e) => {
        const val = e.target.value;
        setSearchText(val);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            fetchItems(1, val);
        }, 400);
    };

    // ==========================================
    // إدارة النماذج (إضافة / تعديل صنف)
    // ==========================================
    const openAddModal = () => { setModalMode('add'); setFormData(initialFormState); setShowModal(true); };
    
    const openEditModal = (item) => {
        setModalMode('edit');
        setFormData({ 
            id: item.id, 
            part_name: item.part_name, 
            sku: item.sku || '', 
            brand: item.brand || '', 
            location_in_store: item.location_in_store || '', 
            stock_quantity: item.stock_quantity, 
            purchase_price: item.purchase_price, 
            selling_price: item.selling_price 
        });
        setShowModal(true);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        setIsUpdating(true);
        try {
            const now = new Date().toISOString();
            
            const payload = {
                part_name: formData.part_name,
                brand: formData.brand,
                location_in_store: formData.location_in_store,
                stock_quantity: Number(formData.stock_quantity),
                purchase_price: Number(formData.purchase_price),
                selling_price: Number(formData.selling_price),
                is_active: true // حسب الـ Schema الخاصة بك
            };

            // لتجنب تعارض الكود (Unique SKU) إذا كان فارغاً
            if (formData.sku && formData.sku.trim() !== '') {
                payload.sku = formData.sku.trim();
            }

            if (modalMode === 'add') {
                payload.created_at = now.split('T')[0];
                await window.db.inventory_parts.add(payload);
                
                // تسجيل حركة الإضافة في المخزن
                const newlyAddedItem = await window.db.inventory_parts.where('part_name').equals(payload.part_name).last();
                if(newlyAddedItem) {
                    await window.db.stock_movements.add({
                        part_id: newlyAddedItem.id,
                        user_id: userId,
                        movement_type: 'رصيد افتتاحي',
                        quantity: payload.stock_quantity,
                        created_at: now
                    });
                }
                
                showToast("تمت إضافة القطعة للمخزن بنجاح", "success");
            } else {
                payload.updated_at = now;
                await window.db.inventory_parts.update(formData.id, payload);
                showToast("تم تحديث بيانات القطعة", "success");
            }
            
            setShowModal(false);
            fetchStats();
            fetchItems(modalMode === 'add' ? 1 : pagination.current_page, searchText);
        } catch (e) { 
            console.error("Submit Error:", e);
            if(e.name === "ConstraintError") {
                showToast("هذا الكود (SKU) مستخدم لقطعة أخرى بالفعل!", "error");
            } else {
                showToast("حدث خطأ أثناء الحفظ", "error"); 
            }
        } finally { 
            setIsUpdating(false); 
        }
    };

    // ==========================================
    // تسوية الرصيد السريعة (Quick Adjust)
    // ==========================================
    const openAdjustModal = (item) => {
        setAdjustData({ id: item.id, part_name: item.part_name, current_qty: item.stock_quantity, adjust_type: 'add', amount: 1 });
        setShowAdjustModal(true);
    };

    const handleAdjustSubmit = async (e) => {
        e.preventDefault();
        setIsUpdating(true);
        try {
            const currentItem = await window.db.inventory_parts.get(adjustData.id);
            if (!currentItem) throw new Error("القطعة غير موجودة");

            const adjustAmount = Number(adjustData.amount);
            let newQty = Number(currentItem.stock_quantity);

            if (adjustData.adjust_type === 'add') {
                newQty += adjustAmount;
            } else {
                if (newQty < adjustAmount) {
                    showToast("الكمية المسحوبة أكبر من الرصيد المتاح!", "error");
                    setIsUpdating(false);
                    return;
                }
                newQty -= adjustAmount;
            }

            // تحديث الرصيد
            await window.db.inventory_parts.update(adjustData.id, { 
                stock_quantity: newQty,
                updated_at: new Date().toISOString()
            });

            // تسجيل الحركة في جدول stock_movements
            await window.db.stock_movements.add({
                part_id: adjustData.id,
                user_id: userId,
                movement_type: adjustData.adjust_type === 'add' ? 'إضافة بضاعة (تسوية)' : 'سحب بضاعة (تسوية)',
                quantity: adjustAmount,
                created_at: new Date().toISOString()
            });

            showToast("تم تسوية الرصيد وتسجيل الحركة بنجاح", "success");
            setShowAdjustModal(false);
            fetchStats();
            fetchItems(pagination.current_page, searchText);
        } catch (e) { 
            showToast(e.message || "حدث خطأ أثناء التسوية", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    return (
        <div className="space-y-6 relative pb-10">
            
            {/* الهيدر العلوي */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col lg:flex-row justify-between gap-4 items-start lg:items-center">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center text-cyan-600"><i className="fa-solid fa-boxes-stacked"></i></div>
                        المخازن وقطع الغيار
                    </h2>
                    <p className="text-slate-500 text-sm font-bold mt-2">إدارة الأرصدة، تسعير القطع، متابعة النواقص وتقييم رأس المال.</p>
                </div>

                <div className="flex flex-col sm:flex-row w-full lg:w-auto gap-3">
                    <div className="relative w-full sm:w-72">
                        <input type="text" placeholder="بحث باسم القطعة أو الكود..." className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-bold" value={searchText} onChange={handleSearchChange} />
                        <i className="fa-solid fa-magnifying-glass absolute top-1/2 right-4 -translate-y-1/2 text-slate-400"></i>
                    </div>
                    <button onClick={openAddModal} className="bg-gradient-to-l from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-cyan-500/30 flex items-center justify-center gap-2 shrink-0">
                        <i className="fa-solid fa-plus"></i> إضافة صنف جديد
                    </button>
                </div>
            </div>

            {/* الإحصائيات المصغرة */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold mb-1">إجمالي الأصناف المسجلة</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.total_items}</h3>
                    </div>
                    <div className="w-12 h-12 bg-cyan-50 text-cyan-500 rounded-2xl flex items-center justify-center text-xl"><i className="fa-solid fa-box-open"></i></div>
                </div>
                
                <div className="bg-gradient-to-br from-[#0B1120] to-slate-800 p-5 rounded-2xl text-white shadow-lg relative overflow-hidden flex items-center justify-between border border-slate-700">
                    <i className="fa-solid fa-coins absolute -left-4 -bottom-4 text-7xl opacity-10"></i>
                    <div className="relative z-10">
                        <p className="text-slate-400 text-xs font-bold mb-1">إجمالي تكلفة المخزون</p>
                        <h3 className="text-2xl font-black text-emerald-400">{stats.total_value.toLocaleString()} <span className="text-xs font-bold text-emerald-600">ج.م</span></h3>
                    </div>
                    <div className="w-12 h-12 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center text-emerald-400 relative z-10"><i className="fa-solid fa-vault text-xl"></i></div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm flex items-center justify-between group hover:border-rose-300 transition-colors">
                    <div>
                        <p className="text-rose-400 text-xs font-bold mb-1">تنبيهات نواقص المخزون</p>
                        <h3 className="text-3xl font-black text-rose-600">{stats.low_stock} <span className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-1 rounded ml-1">أقل من 5</span></h3>
                    </div>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl transition-all ${stats.low_stock > 0 ? 'bg-rose-100 text-rose-500 animate-pulse' : 'bg-slate-50 text-slate-300'}`}>
                        <i className="fa-solid fa-triangle-exclamation"></i>
                    </div>
                </div>
            </div>

            {/* جدول المخزون */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative">
                {(isLoading || isUpdating) && !showModal && !showAdjustModal && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                        <div className="w-12 h-12 border-4 border-cyan-100 border-t-cyan-500 rounded-full animate-spin"></div>
                    </div>
                )}

                <div className="overflow-x-auto hide-scrollbar">
                    <table className="w-full text-right text-sm">
                        <thead className="bg-slate-50/80 text-slate-500 font-bold border-b border-slate-100">
                            <tr>
                                <th className="p-4 whitespace-nowrap">اسم القطعة / الكود</th>
                                <th className="p-4 whitespace-nowrap">الماركة / المكان</th>
                                <th className="p-4 whitespace-nowrap text-center">الرصيد الحالي</th>
                                <th className="p-4 whitespace-nowrap">الأسعار (شراء / بيع)</th>
                                <th className="p-4 whitespace-nowrap text-center">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {items?.length > 0 ? items.map((item) => {
                                const isLowStock = parseInt(item.stock_quantity) <= 5;
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="p-4">
                                            <p className="font-bold text-slate-800">{item.part_name}</p>
                                            {item.sku && <p className="text-[10px] font-black text-slate-400 mt-1 tracking-wider font-mono bg-slate-100 inline-block px-1.5 py-0.5 rounded" dir="ltr"><i className="fa-solid fa-barcode mr-1"></i>{item.sku}</p>}
                                        </td>
                                        <td className="p-4">
                                            {item.brand && <span className="block text-[11px] font-bold text-slate-600 mb-1"><i className="fa-solid fa-tag text-slate-400 w-3"></i> {item.brand}</span>}
                                            {item.location_in_store && <span className="block text-[10px] font-bold text-slate-400"><i className="fa-solid fa-map-pin text-slate-300 w-3"></i> الرف: {item.location_in_store}</span>}
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-1.5 shadow-sm">
                                                <span className={`text-sm font-black ${isLowStock ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                    {item.stock_quantity}
                                                </span>
                                                {isLowStock && <i className="fa-solid fa-circle-exclamation text-rose-500 animate-pulse text-[10px]" title="نواقص المخزن"></i>}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1 text-xs font-bold">
                                                <span className="text-slate-500">شراء: <span className="text-slate-800 font-black">{Number(item.purchase_price).toLocaleString()}</span></span>
                                                <span className="text-cyan-600">بيع: <span className="text-cyan-700 font-black">{Number(item.selling_price).toLocaleString()}</span></span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2 opacity-100 sm:opacity-50 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => openAdjustModal(item)} className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all shadow-sm flex items-center justify-center" title="تسوية الرصيد (إضافة/سحب)">
                                                    <i className="fa-solid fa-boxes-packing text-xs"></i>
                                                </button>
                                                <button onClick={() => openEditModal(item)} className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:bg-cyan-500 hover:text-white hover:border-cyan-500 transition-all shadow-sm flex items-center justify-center" title="تعديل تفاصيل القطعة">
                                                    <i className="fa-solid fa-pen text-xs"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-bold"><div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-box-open text-2xl"></i></div>لا توجد أصناف تطابق البحث.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {/* نظام التقليب */}
                {pagination.total > 0 && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <span className="text-[11px] font-bold text-slate-500">صفحة {pagination.current_page} من {pagination.last_page} <span className="mr-2 px-2 py-0.5 bg-white rounded-md border border-slate-200">إجمالي: {pagination.total}</span></span>
                        <div className="flex gap-2">
                            <button onClick={() => fetchItems(pagination.current_page + 1, searchText)} disabled={pagination.current_page === pagination.last_page || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-right text-xs"></i></button>
                            <button onClick={() => fetchItems(pagination.current_page - 1, searchText)} disabled={pagination.current_page === 1 || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-left text-xs"></i></button>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================== */}
            {/* إعلان النسخة المدفوعة */}
            {/* ========================================== */}
            <div className="mt-8 bg-[#0B1120] rounded-3xl p-6 md:p-8 border border-cyan-500/30 shadow-[0_10px_40px_rgba(6,182,212,0.15)] relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-cyan-500/60 transition-all">
                <div className="absolute top-0 left-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/4 pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-500"></div>
                <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 translate-x-1/4 pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                
                <div className="relative z-10 flex items-center gap-5">
                    <div className="hidden sm:flex w-16 h-16 rounded-2xl bg-gradient-to-br from-[#06B6D4] to-[#3B82F6] items-center justify-center text-white text-3xl shadow-lg shadow-cyan-500/25 shrink-0">
                        <i className="fa-solid fa-warehouse"></i>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">Pro Version</span>
                            <h3 className="text-xl md:text-2xl font-black text-white">تحكم في مخازن فروعك سحابياً!</h3>
                        </div>
                        <p className="text-slate-400 text-xs md:text-sm font-bold mt-2 max-w-xl leading-relaxed">
                            احصل على النسخة المدفوعة لإدارة جرد المخازن بين الفروع، طباعة باركود للقطع (Barcode)، تقارير الأرباح والمبيعات، ومزامنة البيانات في الوقت الفعلي مع فريق عملك.
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
            {/* 1. نافذة إضافة / تعديل الصنف */}
            {/* ========================================== */}
            {showModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-0">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl z-10 overflow-hidden animate-view border border-slate-100 flex flex-col max-h-[90vh]">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                <i className={`fa-solid ${modalMode === 'add' ? 'fa-box-open text-cyan-500' : 'fa-pen-to-square text-blue-500'}`}></i>
                                {modalMode === 'add' ? 'إضافة قطعة جديدة' : 'تعديل بيانات القطعة'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 flex items-center justify-center transition-all"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        
                        <div className="overflow-y-auto p-6">
                            <form id="itemForm" onSubmit={handleFormSubmit} className="space-y-5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم القطعة <span className="text-rose-500">*</span></label>
                                        <input type="text" required className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white" value={formData.part_name} onChange={(e) => setFormData({...formData, part_name: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">الكود (SKU)</label>
                                        <input type="text" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white text-left font-mono" dir="ltr" placeholder="اختياري" value={formData.sku} onChange={(e) => setFormData({...formData, sku: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">الماركة (Brand)</label>
                                        <input type="text" placeholder="مثال: Samsung, Original..." className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white" value={formData.brand} onChange={(e) => setFormData({...formData, brand: e.target.value})} />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">مكان القطعة بالرف (Location)</label>
                                    <input type="text" placeholder="مثال: رف 3، درج A" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white" value={formData.location_in_store} onChange={(e) => setFormData({...formData, location_in_store: e.target.value})} />
                                </div>

                                {modalMode === 'add' && (
                                    <div className="bg-cyan-50/50 p-4 rounded-2xl border border-cyan-100">
                                        <label className="block text-xs font-bold text-cyan-800 mb-1.5">الرصيد الافتتاحي (الكمية الحالية) <span className="text-rose-500">*</span></label>
                                        <input type="number" min="0" required className="w-full border border-cyan-200 rounded-xl px-4 py-3 text-sm font-black text-cyan-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 bg-white" value={formData.stock_quantity} onChange={(e) => setFormData({...formData, stock_quantity: e.target.value})} />
                                        <p className="text-[10px] text-cyan-600 font-bold mt-2"><i className="fa-solid fa-circle-info mr-1"></i> لتعديل الرصيد لاحقاً، استخدم زر "التسوية" من الجدول.</p>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر الشراء (التكلفة) <span className="text-rose-500">*</span></label>
                                        <div className="relative">
                                            <input type="number" step="0.01" min="0" required className="w-full border border-slate-200 rounded-xl px-4 py-3 pl-10 text-sm font-black text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white" value={formData.purchase_price} onChange={(e) => setFormData({...formData, purchase_price: e.target.value})} />
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">ج.م</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر البيع للعميل <span className="text-rose-500">*</span></label>
                                        <div className="relative">
                                            <input type="number" step="0.01" min="0" required className="w-full border border-cyan-200 rounded-xl px-4 py-3 pl-10 text-sm font-black text-cyan-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-cyan-50" value={formData.selling_price} onChange={(e) => setFormData({...formData, selling_price: e.target.value})} />
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-600 text-xs font-bold">ج.م</span>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                        
                        <div className="p-5 border-t border-slate-100 flex gap-3 bg-slate-50 shrink-0">
                            <button type="submit" form="itemForm" disabled={isUpdating} className="flex-1 bg-gradient-to-l from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-70 text-sm shadow-lg shadow-cyan-500/25">
                                {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>} {modalMode === 'add' ? 'إضافة للمخزن' : 'تحديث البيانات'}
                            </button>
                            <button type="button" onClick={() => setShowModal(false)} className="px-6 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl font-bold transition-colors text-sm">إلغاء</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* 2. نافذة التسوية السريعة للرصيد (Quick Adjust) */}
            {/* ========================================== */}
            {showAdjustModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAdjustModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm z-10 overflow-hidden animate-view border border-slate-100">
                        <div className="p-5 border-b border-slate-100 bg-slate-50/50 text-center relative">
                            <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-600 mx-auto mb-3">
                                <i className="fa-solid fa-boxes-packing text-xl"></i>
                            </div>
                            <h3 className="text-lg font-black text-slate-800">تعديل رصيد الصنف</h3>
                            <p className="text-xs text-slate-500 font-bold mt-1 bg-white inline-block px-3 py-1 rounded-lg border border-slate-200">{adjustData.part_name}</p>
                            <button onClick={() => setShowAdjustModal(false)} className="absolute left-4 top-4 w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        <form onSubmit={handleAdjustSubmit} className="p-6 space-y-6">
                            
                            <div className="flex justify-between items-center bg-slate-50 rounded-xl p-3 border border-slate-100">
                                <span className="text-xs font-bold text-slate-500">الرصيد الحالي بالمخزن:</span>
                                <span className="bg-white border border-slate-200 text-slate-800 px-3 py-1 rounded-lg text-lg font-black shadow-sm">{adjustData.current_qty}</span>
                            </div>

                            <div className="flex bg-slate-100 rounded-xl p-1.5 gap-1">
                                <button type="button" onClick={() => setAdjustData({...adjustData, adjust_type: 'add'})} className={`flex-1 py-2.5 text-xs font-black rounded-lg transition-all flex items-center justify-center gap-2 ${adjustData.adjust_type === 'add' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}>
                                    <i className="fa-solid fa-plus"></i> إدخال بضاعة
                                </button>
                                <button type="button" onClick={() => setAdjustData({...adjustData, adjust_type: 'sub'})} className={`flex-1 py-2.5 text-xs font-black rounded-lg transition-all flex items-center justify-center gap-2 ${adjustData.adjust_type === 'sub' ? 'bg-rose-500 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}>
                                    <i className="fa-solid fa-minus"></i> سحب بضاعة
                                </button>
                            </div>

                            <div>
                                <label className="block text-center text-xs font-bold text-slate-700 mb-2">
                                    الكمية المُراد {adjustData.adjust_type === 'add' ? 'إضافتها للمخزن' : 'سحبها من المخزن'}
                                </label>
                                <input type="number" min="1" max={adjustData.adjust_type === 'sub' ? adjustData.current_qty : undefined} required className={`w-full text-center text-3xl font-black rounded-2xl px-4 py-4 focus:outline-none border-2 transition-colors ${adjustData.adjust_type === 'add' ? 'border-emerald-200 focus:border-emerald-500 text-emerald-700 bg-emerald-50/50' : 'border-rose-200 focus:border-rose-500 text-rose-700 bg-rose-50/50'}`} value={adjustData.amount} onChange={(e) => setAdjustData({...adjustData, amount: e.target.value})} />
                            </div>

                            <button type="submit" disabled={isUpdating} className={`w-full py-3.5 rounded-xl font-black transition-all text-white disabled:opacity-70 flex items-center justify-center gap-2 shadow-lg ${adjustData.adjust_type === 'add' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/30'}`}>
                                {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check-double"></i>} تأكيد التسوية
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};