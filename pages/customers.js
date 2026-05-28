// pages/customers.js

window.Module_Customers = function({ centerId, userId, showToast, setActiveModule }) {
    const { useState, useEffect } = React;
    
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    
    // 1. بيانات الجدول والإحصائيات
    const [customers, setCustomers] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [stats, setStats] = useState({ total: 0, individuals: 0, companies: 0 });
    const [searchQuery, setSearchQuery] = useState('');

    // 2. بيانات نافذة العميل
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState('add');
    const initialFormState = { id: null, name: '', phone: '', alt_phone: '', address: '', customer_type: 'individual' };
    const [formData, setFormData] = useState(initialFormState);

    // 3. بيانات نافذة الأجهزة
    const [showDeviceModal, setShowDeviceModal] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerDevices, setCustomerDevices] = useState([]);
    const initialDeviceForm = { device_type: '', brand: '', model: '', serial_number: '', warranty_status: 'out_of_warranty', notes: '' };
    const [deviceFormData, setDeviceFormData] = useState(initialDeviceForm);

    // ==========================================
    // دوال قاعدة البيانات المحلية (Dexie.js)
    // ==========================================
    const fetchStats = async () => {
        try {
            const allCustomers = await window.db.customers.toArray();
            setStats({
                total: allCustomers.length,
                individuals: allCustomers.filter(c => c.customer_type === 'individual').length,
                companies: allCustomers.filter(c => c.customer_type === 'company').length
            });
        } catch (e) { console.error("Error fetching stats", e); }
    };

    const fetchCustomers = async (page = 1, search = searchQuery) => {
        setIsLoading(true);
        try {
            let allItems = await window.db.customers.reverse().toArray(); // الأحدث أولاً
            
            // البحث
            if (search.trim() !== '') {
                const lowerSearch = search.toLowerCase();
                allItems = allItems.filter(c => 
                    c.name.toLowerCase().includes(lowerSearch) || 
                    c.phone.includes(search) || 
                    (c.alt_phone && c.alt_phone.includes(search))
                );
            }

            // جلب عدد الأجهزة لكل عميل
            for (let c of allItems) {
                c.devices_count = await window.db.devices.where('customer_id').equals(c.id).count();
            }

            // نظام التقليب (Pagination) محلياً
            const perPage = 3;
            const total = allItems.length;
            const last_page = Math.ceil(total / perPage) || 1;
            const paginatedItems = allItems.slice((page - 1) * perPage, page * perPage);

            setCustomers(paginatedItems);
            setPagination({ current_page: page, last_page, total });
        } catch (error) { 
            showToast("حدث خطأ في قراءة بيانات العملاء", "error"); 
            console.error(error);
        } finally { 
            setIsLoading(false); 
        }
    };

    useEffect(() => {
        fetchStats();
        fetchCustomers(1, '');
    }, []);

    const handleSearch = (e) => {
        e.preventDefault();
        fetchCustomers(1, searchQuery);
    };

    // ==========================================
    // دوال الأجهزة
    // ==========================================
    const fetchCustomerDevices = async (customerId) => {
        try {
            const devices = await window.db.devices.where('customer_id').equals(customerId).reverse().toArray();
            setCustomerDevices(devices);
        } catch (e) { showToast("خطأ في جلب الأجهزة", "error"); }
    };

    const openDeviceModal = (customer) => {
        setSelectedCustomer(customer);
        setDeviceFormData(initialDeviceForm);
        setCustomerDevices([]); 
        setShowDeviceModal(true);
        fetchCustomerDevices(customer.id);
    };

    const handleDeviceSubmit = async (e) => {
        e.preventDefault();
        setIsUpdating(true);
        try {
            const payload = { 
                ...deviceFormData, 
                customer_id: selectedCustomer.id,
                created_at: new Date().toISOString()
            };
            
            await window.db.devices.add(payload);
            showToast("تمت إضافة الجهاز بنجاح", "success");
            
            setDeviceFormData(initialDeviceForm); 
            fetchCustomerDevices(selectedCustomer.id); 
            fetchCustomers(pagination.current_page, searchQuery); // لتحديث عداد الأجهزة في الجدول
        } catch (e) { 
            showToast("حدث خطأ أثناء الحفظ", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    // ==========================================
    // دوال إضافة وتعديل العملاء
    // ==========================================
    const openAddModal = () => { setModalMode('add'); setFormData(initialFormState); setShowModal(true); };
    
    const openEditModal = (customer) => {
        setModalMode('edit');
        setFormData({ 
            id: customer.id, 
            name: customer.name, 
            phone: customer.phone, 
            alt_phone: customer.alt_phone || '', 
            address: customer.address || '', 
            customer_type: customer.customer_type 
        });
        setShowModal(true);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        setIsUpdating(true);
        try {
            const now = new Date().toISOString();
            if (modalMode === 'add') {
                await window.db.customers.add({
                    name: formData.name,
                    phone: formData.phone,
                    alt_phone: formData.alt_phone,
                    address: formData.address,
                    customer_type: formData.customer_type,
                    created_at: now.split('T')[0] // تاريخ فقط
                });
                showToast("تم تسجيل العميل بنجاح", "success");
            } else {
                await window.db.customers.update(formData.id, {
                    name: formData.name,
                    phone: formData.phone,
                    alt_phone: formData.alt_phone,
                    address: formData.address,
                    customer_type: formData.customer_type,
                    updated_at: now
                });
                showToast("تم تحديث بيانات العميل", "success");
            }
            
            setShowModal(false);
            fetchStats();
            fetchCustomers(modalMode === 'add' ? 1 : pagination.current_page, searchQuery);
        } catch (e) { 
            showToast("حدث خطأ أثناء الحفظ", "error"); 
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
                        <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center text-cyan-600"><i className="fa-solid fa-users"></i></div>
                        إدارة العملاء
                    </h2>
                    <p className="text-slate-500 text-sm font-bold mt-2">سجل بيانات عملائك وأجهزتهم لسهولة استخراج الفواتير وأوامر الشغل.</p>
                </div>

                <div className="flex flex-col sm:flex-row w-full lg:w-auto gap-3">
                    <form onSubmit={handleSearch} className="relative w-full sm:w-72">
                        <input type="text" placeholder="بحث بالاسم أو رقم الهاتف..." className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-bold" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        <button type="submit" className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-cyan-600 transition-colors w-8 h-8 flex items-center justify-center"><i className="fa-solid fa-magnifying-glass"></i></button>
                    </form>
                    <button onClick={openAddModal} className="bg-gradient-to-l from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-cyan-500/30 flex items-center justify-center gap-2 shrink-0">
                        <i className="fa-solid fa-user-plus"></i> إضافة عميل جديد
                    </button>
                </div>
            </div>

            {/* الإحصائيات المصغرة */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-[#0B1120] to-slate-800 p-5 rounded-2xl text-white shadow-lg relative overflow-hidden flex items-center justify-between">
                    <i className="fa-solid fa-users absolute -left-2 -bottom-2 text-7xl opacity-10"></i>
                    <div className="relative z-10">
                        <p className="text-slate-400 text-xs font-bold mb-1">إجمالي العملاء</p>
                        <h3 className="text-3xl font-black">{stats.total}</h3>
                    </div>
                    <div className="w-12 h-12 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center relative z-10"><i className="fa-solid fa-chart-simple text-cyan-400 text-xl"></i></div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold mb-1">أفراد (شخصي)</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.individuals}</h3>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-user text-xl"></i></div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-slate-400 text-xs font-bold mb-1">شركات / مؤسسات</p>
                        <h3 className="text-3xl font-black text-slate-800">{stats.companies}</h3>
                    </div>
                    <div className="w-12 h-12 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-building text-xl"></i></div>
                </div>
            </div>

            {/* جدول البيانات الرئيسي */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative">
                {(isLoading || isUpdating) && !showModal && !showDeviceModal && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                        <div className="w-12 h-12 border-4 border-cyan-100 border-t-cyan-500 rounded-full animate-spin"></div>
                    </div>
                )}

                <div className="overflow-x-auto hide-scrollbar">
                    <table className="w-full text-right text-sm">
                        <thead className="bg-slate-50/80 text-slate-500 font-bold border-b border-slate-100">
                            <tr>
                                <th className="p-4 whitespace-nowrap">بيانات العميل</th>
                                <th className="p-4 whitespace-nowrap">النوع</th>
                                <th className="p-4 whitespace-nowrap">أرقام التواصل</th>
                                <th className="p-4 whitespace-nowrap">الأجهزة</th>
                                <th className="p-4 whitespace-nowrap">تاريخ التسجيل</th>
                                <th className="p-4 whitespace-nowrap text-center">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {customers?.length > 0 ? customers.map((customer) => (
                                <tr key={customer.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-4">
                                        <p className="font-bold text-slate-800">{customer.name}</p>
                                        <p className="text-[11px] font-bold text-slate-400 mt-1 flex items-center gap-1 max-w-[200px] truncate" title={customer.address}><i className="fa-solid fa-location-dot"></i> {customer.address || 'بدون عنوان'}</p>
                                    </td>
                                    <td className="p-4">
                                        {customer.customer_type === 'individual' 
                                            ? <span className="text-[11px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100"><i className="fa-solid fa-user ml-1"></i> فرد</span>
                                            : <span className="text-[11px] font-black text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100"><i className="fa-solid fa-building ml-1"></i> شركة</span>
                                        }
                                    </td>
                                    <td className="p-4">
                                        <p className="font-bold text-slate-700" dir="ltr">{customer.phone}</p>
                                        {customer.alt_phone && <p className="text-[11px] font-bold text-slate-400 mt-0.5" dir="ltr">{customer.alt_phone}</p>}
                                    </td>
                                    <td className="p-4">
                                        <button onClick={() => openDeviceModal(customer)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-50 text-cyan-600 hover:bg-cyan-600 hover:text-white transition-all font-bold text-xs border border-cyan-100 hover:border-cyan-600">
                                            <i className="fa-solid fa-laptop-medical"></i> 
                                            <span>{customer.devices_count || 0} جهاز</span>
                                        </button>
                                    </td>
                                    <td className="p-4 text-[11px] font-bold text-slate-400" dir="ltr">{customer.created_at}</td>
                                    <td className="p-4 text-center">
                                        <button onClick={() => openEditModal(customer)} className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:bg-cyan-500 hover:text-white hover:border-cyan-500 transition-all flex items-center justify-center mx-auto" title="تعديل">
                                            <i className="fa-solid fa-pen text-xs"></i>
                                        </button>
                                    </td>
                                </tr>
                            )) : <tr><td colSpan="6" className="p-12 text-center text-slate-400 font-bold"><div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-users-slash text-2xl"></i></div>لا يوجد عملاء يطابقون البحث الحالي.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {/* نظام التقليب */}
                {pagination.total > 0 && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <span className="text-[11px] font-bold text-slate-500">صفحة {pagination.current_page} من {pagination.last_page} <span className="mr-2 px-2 py-0.5 bg-white rounded-md border border-slate-200">إجمالي: {pagination.total}</span></span>
                        <div className="flex gap-2">
                            <button onClick={() => fetchCustomers(pagination.current_page + 1, searchQuery)} disabled={pagination.current_page === pagination.last_page || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-right text-xs"></i></button>
                            <button onClick={() => fetchCustomers(pagination.current_page - 1, searchQuery)} disabled={pagination.current_page === 1 || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-left text-xs"></i></button>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================== */}
            {/* إعلان النسخة المدفوعة (أسفل الصفحة) */}
            {/* ========================================== */}
            <div className="mt-8 bg-[#0B1120] rounded-3xl p-6 md:p-8 border border-cyan-500/30 shadow-[0_10px_40px_rgba(6,182,212,0.15)] relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-cyan-500/60 transition-all">
                {/* تأثيرات الخلفية */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-500"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4 pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                
                <div className="relative z-10 flex items-center gap-5">
                    <div className="hidden sm:flex w-16 h-16 rounded-2xl bg-gradient-to-br from-[#06B6D4] to-[#3B82F6] items-center justify-center text-white text-3xl shadow-lg shadow-cyan-500/25 shrink-0">
                        <i className="fa-solid fa-cloud-arrow-up"></i>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">Pro Version</span>
                            <h3 className="text-xl md:text-2xl font-black text-white">طوّر نظامك إلى النسخة السحابية!</h3>
                        </div>
                        <p className="text-slate-400 text-xs md:text-sm font-bold mt-2 max-w-xl leading-relaxed">
                            احمِ بياناتك من الضياع، تابع مركزك من الموبايل في أي مكان، اربط فروعك وأضف موظفيك بصلاحيات متقدمة، وارسل فواتير WhatsApp للعملاء بضغطة زر.
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
            {/* 1. نافذة الإضافة / التعديل للعميل */}
            {/* ========================================== */}
            {showModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-0">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg z-10 overflow-hidden animate-view border border-slate-100">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                <i className={`fa-solid ${modalMode === 'add' ? 'fa-user-plus text-cyan-500' : 'fa-user-pen text-blue-500'}`}></i>
                                {modalMode === 'add' ? 'إضافة عميل جديد' : 'تعديل بيانات العميل'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 flex items-center justify-center transition-all"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        <form onSubmit={handleFormSubmit} className="p-6 space-y-5">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم العميل <span className="text-rose-500">*</span></label>
                                <input type="text" required className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white" placeholder="الاسم ثلاثي أو اسم الشركة" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">رقم الهاتف <span className="text-rose-500">*</span></label>
                                    <input type="text" required className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white text-left" dir="ltr" placeholder="01xxxxxxxxx" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">رقم هاتف بديل</label>
                                    <input type="text" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white text-left" dir="ltr" placeholder="اختياري" value={formData.alt_phone} onChange={(e) => setFormData({...formData, alt_phone: e.target.value})} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">نوع العميل <span className="text-rose-500">*</span></label>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className={`border rounded-xl p-3 flex items-center justify-center gap-2 cursor-pointer font-bold text-sm transition-all ${formData.customer_type === 'individual' ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                        <input type="radio" name="c_type" value="individual" className="hidden" checked={formData.customer_type === 'individual'} onChange={(e) => setFormData({...formData, customer_type: e.target.value})} />
                                        <i className="fa-solid fa-user"></i> فرد (شخصي)
                                    </label>
                                    <label className={`border rounded-xl p-3 flex items-center justify-center gap-2 cursor-pointer font-bold text-sm transition-all ${formData.customer_type === 'company' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                        <input type="radio" name="c_type" value="company" className="hidden" checked={formData.customer_type === 'company'} onChange={(e) => setFormData({...formData, customer_type: e.target.value})} />
                                        <i className="fa-solid fa-building"></i> شركة / مؤسسة
                                    </label>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">العنوان</label>
                                <textarea rows="2" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all bg-slate-50 focus:bg-white resize-none" placeholder="اكتب العنوان بالتفصيل..." value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})}></textarea>
                            </div>
                            <div className="pt-2 flex gap-3">
                                <button type="submit" disabled={isUpdating} className="flex-1 bg-gradient-to-l from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-70 text-sm shadow-lg shadow-cyan-500/25">
                                    {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>} {modalMode === 'add' ? 'حفظ العميل' : 'تحديث البيانات'}
                                </button>
                                <button type="button" onClick={() => setShowModal(false)} className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-colors text-sm">إلغاء</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* 2. نافذة إدارة الأجهزة (متجاوبة تماماً) */}
            {/* ========================================== */}
            {showDeviceModal && selectedCustomer && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-2 sm:p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowDeviceModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl z-10 overflow-hidden animate-view flex flex-col h-[90vh] sm:h-auto sm:max-h-[85vh] border border-slate-100">
                        
                        {/* هيدر النافذة */}
                        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-cyan-50 text-cyan-500 flex items-center justify-center"><i className="fa-solid fa-laptop-medical"></i></div> 
                                    أجهزة: {selectedCustomer.name}
                                </h3>
                                <p className="text-slate-400 text-[11px] sm:text-xs mt-1 font-bold ml-10">{selectedCustomer.phone}</p>
                            </div>
                            <button onClick={() => setShowDeviceModal(false)} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark"></i></button>
                        </div>

                        {/* المحتوى - مقسم لعمودين (فوق بعض في الموبايل، جمب بعض في الكمبيوتر) */}
                        <div className="flex-1 overflow-y-auto flex flex-col md:flex-row bg-slate-50/50">
                            
                            {/* القسم الأيمن: نموذج الإضافة */}
                            <div className="w-full md:w-5/12 p-4 sm:p-5 bg-white border-b md:border-b-0 md:border-l border-slate-100 shrink-0">
                                <h4 className="font-black text-slate-700 mb-4 text-sm flex items-center gap-2"><i className="fa-solid fa-plus-circle text-cyan-500"></i> إضافة جهاز جديد</h4>
                                <form onSubmit={handleDeviceSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 mb-1.5">نوع الجهاز <span className="text-rose-500">*</span></label>
                                        <input type="text" required placeholder="مثال: ثلاجة، شاشة، لاب توب..." className="w-full border border-slate-200 bg-slate-50 focus:bg-white rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-cyan-500 transition-all" value={deviceFormData.device_type} onChange={(e) => setDeviceFormData({...deviceFormData, device_type: e.target.value})} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-500 mb-1.5">الماركة (Brand)</label>
                                            <input type="text" placeholder="مثال: LG" className="w-full border border-slate-200 bg-slate-50 focus:bg-white rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-cyan-500 transition-all" value={deviceFormData.brand} onChange={(e) => setDeviceFormData({...deviceFormData, brand: e.target.value})} />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-500 mb-1.5">الموديل</label>
                                            <input type="text" placeholder="رقم الموديل" className="w-full border border-slate-200 bg-slate-50 focus:bg-white rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-cyan-500 transition-all" value={deviceFormData.model} onChange={(e) => setDeviceFormData({...deviceFormData, model: e.target.value})} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 mb-1.5">الرقم التسلسلي (S/N)</label>
                                        <input type="text" placeholder="Serial Number" className="w-full border border-slate-200 bg-slate-50 focus:bg-white rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-cyan-500 transition-all text-left" dir="ltr" value={deviceFormData.serial_number} onChange={(e) => setDeviceFormData({...deviceFormData, serial_number: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 mb-1.5">الضمان</label>
                                        <select className="w-full border border-slate-200 bg-slate-50 focus:bg-white rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-cyan-500 transition-all" value={deviceFormData.warranty_status} onChange={(e) => setDeviceFormData({...deviceFormData, warranty_status: e.target.value})}>
                                            <option value="out_of_warranty">خارج الضمان</option>
                                            <option value="in_warranty">داخل الضمان (ساري)</option>
                                        </select>
                                    </div>
                                    <button type="submit" disabled={isUpdating} className="w-full bg-cyan-50 text-cyan-600 border border-cyan-100 hover:bg-cyan-500 hover:text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 mt-2 text-sm disabled:opacity-50">
                                        {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>} حفظ الجهاز
                                    </button>
                                </form>
                            </div>

                            {/* القسم الأيسر: قائمة الأجهزة */}
                            <div className="w-full md:w-7/12 p-4 sm:p-5 flex flex-col h-full min-h-[300px]">
                                <h4 className="font-black text-slate-700 mb-4 text-sm flex items-center justify-between">
                                    <span><i className="fa-solid fa-list text-slate-400 ml-2"></i> الأجهزة المسجلة</span>
                                    <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md text-[10px]">{customerDevices.length} جهاز</span>
                                </h4>
                                
                                <div className="flex-1 overflow-y-auto space-y-3 pr-1 hide-scrollbar">
                                    {customerDevices?.length > 0 ? customerDevices.map((device) => (
                                        <div key={device.id} className="flex items-start gap-3 p-3 sm:p-4 rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-cyan-300 transition-colors group">
                                            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 text-slate-400 flex items-center justify-center shrink-0 group-hover:bg-cyan-50 group-hover:text-cyan-500 group-hover:border-cyan-100 transition-colors">
                                                <i className="fa-solid fa-laptop text-lg"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h5 className="font-black text-slate-800 text-sm truncate">{device.device_type} {device.brand ? <span className="text-cyan-600 ml-1">- {device.brand}</span> : ''}</h5>
                                                    {device.warranty_status === 'in_warranty' && (
                                                        <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg border border-emerald-100 shrink-0"><i className="fa-solid fa-shield-check"></i> ضمان</span>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                                                    {device.model && <p className="text-[11px] font-bold text-slate-400">الموديل: <span className="text-slate-700">{device.model}</span></p>}
                                                    {device.serial_number && <p className="text-[11px] font-bold text-slate-400">S/N: <span className="text-slate-700 font-mono" dir="ltr">{device.serial_number}</span></p>}
                                                </div>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
                                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3"><i className="fa-solid fa-box-open text-2xl text-slate-300"></i></div>
                                            <p className="text-slate-500 font-bold text-sm">لا يوجد أجهزة مسجلة لهذا العميل</p>
                                            <p className="text-slate-400 font-semibold text-xs mt-1">استخدم النموذج لإضافة جهاز جديد</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};