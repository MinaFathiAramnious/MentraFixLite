window.Module_MaintenanceRequests = function({ centerId, userId, showToast, setActiveModule }) {
    const { useState, useEffect, useRef } = React;

    // ==========================================
    // 1. الحالات الأساسية والـ Pagination
    // ==========================================
    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total_records: 0 });
    
    const [activeTab, setActiveTab] = useState('الكل');
    const [searchQuery, setSearchQuery] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const limit = 3; 

    // ==========================================
    // 2. حالة نافذة إضافة/تعديل أمر الشغل الأساسية
    // ==========================================
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState('add');
    const [technicians, setTechnicians] = useState([]);
    const [customerDevices, setCustomerDevices] = useState([]);
    
    const initialFormState = {
        id: null, customer_id: '', device_id: '', maintenance_type: 'داخلي',
        issue_description: '', technician_id: '', estimated_cost: ''
    };
    const [formData, setFormData] = useState(initialFormState);

    const [customerSearchText, setCustomerSearchText] = useState('');
    const [customerSearchResults, setCustomerSearchResults] = useState([]);
    const [isSearchingCustomers, setIsSearchingCustomers] = useState(false);
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const dropdownRef = useRef(null);
    const searchTimeoutRef = useRef(null);

    const [deviceSearchText, setDeviceSearchText] = useState('');
    const [deviceSearchResults, setDeviceSearchResults] = useState([]);
    const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
    const deviceDropdownRef = useRef(null);

    // ==========================================
    // 3. حالة نافذة إدارة قطع الغيار (المخزن)
    // ==========================================
    const [showPartsModal, setShowPartsModal] = useState(false);
    const [selectedOrderForParts, setSelectedOrderForParts] = useState(null);
    const [usedParts, setUsedParts] = useState([]);
    const [partForm, setPartForm] = useState({ part_id: '', quantity: 1, max_qty: 1, price: 0 });
    const [isPartsLoading, setIsPartsLoading] = useState(false);

    const [partSearchText, setPartSearchText] = useState('');
    const [partSearchResults, setPartSearchResults] = useState([]);
    const [isSearchingParts, setIsSearchingParts] = useState(false);
    const [showPartDropdown, setShowPartDropdown] = useState(false);
    const partDropdownRef = useRef(null);
    const partSearchTimeoutRef = useRef(null);

    // =========================================================================
    // جلب البيانات الأساسية (Read & Paginate)
    // =========================================================================
    const fetchOrders = async (page = 1, status = activeTab, search = searchQuery) => {
        setIsLoading(true);
        try {
            let allOrders = await window.db.maintenance_requests.orderBy('id').reverse().toArray();

            for (let order of allOrders) {
                const customer = await window.db.customers.get(order.customer_id);
                const device = await window.db.devices.get(order.device_id);
                let techName = null;
                if(order.technician_id) {
                    const tech = await window.db.users.get(parseInt(order.technician_id));
                    if(tech) techName = tech.name;
                }

                order.customer_name = customer ? customer.name : 'عميل محذوف';
                order.customer_phone = customer ? String(customer.phone) : '';
                order.device_type = device ? device.device_type : 'جهاز محذوف';
                order.brand = device ? device.brand : '';
                order.technician_name = techName;
            }

            if (status !== 'الكل') {
                allOrders = allOrders.filter(o => o.status === status);
            }

            if (search.trim() !== '') {
                const query = search.toLowerCase().trim();
                allOrders = allOrders.filter(o => 
                    String(o.id) === query ||
                    (o.customer_name && o.customer_name.toLowerCase().includes(query)) ||
                    (o.customer_phone && o.customer_phone.includes(query))
                );
            }

            const totalRecords = allOrders.length;
            const totalPages = Math.ceil(totalRecords / limit) || 1;
            const pagedOrders = allOrders.slice((page - 1) * limit, page * limit);

            setOrders(pagedOrders);
            setPagination({ current_page: page, last_page: totalPages, total_records: totalRecords });

        } catch (e) {
            console.error(e);
            showToast("حدث خطأ في تحميل الطلبات", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const fetchFormOptions = async () => {
        try {
            const users = await window.db.users.filter(u => u.is_active === 1 || u.is_active === true).toArray();
            setTechnicians(users);
        } catch (e) { console.error(e); }
    };

    useEffect(() => { fetchOrders(1, activeTab, searchQuery); }, [activeTab]);
    useEffect(() => { fetchFormOptions(); }, []); 

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setShowCustomerDropdown(false);
            if (deviceDropdownRef.current && !deviceDropdownRef.current.contains(event.target)) setShowDeviceDropdown(false);
            if (partDropdownRef.current && !partDropdownRef.current.contains(event.target)) setShowPartDropdown(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSearch = (e) => { e.preventDefault(); fetchOrders(1, activeTab, searchQuery); };

    // =========================================================================
    // تحديث حالة أمر الشغل (الربط المالي وإصدار الفاتورة عند التسليم)
    // =========================================================================
    const handleStatusChange = async (orderId, newStatus) => {
        setIsUpdating(true);
        try {
            if (newStatus === 'تم التسليم') {
                const request = await window.db.maintenance_requests.get(orderId);
                const usedItems = await window.db.used_items.where('request_id').equals(orderId).toArray();
                const laborCost = parseFloat(request.estimated_cost) || 0;
                const partsCost = usedItems.reduce((sum, item) => sum + (parseFloat(item.total_price) || 0), 0);
                const finalTotal = laborCost + partsCost;

                const invoiceId = await window.CenterQueries.finishRequestAndCreateInvoice(
                    orderId, 
                    request.customer_id, 
                    finalTotal
                );

                await window.CenterQueries.payInvoice(invoiceId, finalTotal, 'كاش');

                showToast(`تم تسليم الجهاز، إنشاء الفاتورة، وتحصيل (${finalTotal} ج.م) كاش بنجاح`, "success");
            } else {
                await window.db.maintenance_requests.update(orderId, { status: newStatus });
                showToast(`تم تغيير الحالة إلى: ${newStatus}`, "success");
            }
            
            fetchOrders(pagination.current_page, activeTab, searchQuery);
        } catch (e) { 
            console.error("Error updating status:", e);
            showToast("خطأ في التحديث (تأكد من وجود العميل)", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    // =========================================================================
    // دوال نافذة الإضافة والتعديل الأساسية
    // =========================================================================
    const openAddModal = () => {
        setModalMode('add');
        setFormData(initialFormState);
        setCustomerSearchText('');
        setDeviceSearchText('');
        setCustomerDevices([]);
        setDeviceSearchResults([]);
        setShowModal(true);
    };

    const fetchCustomerDevices = async (customerId) => {
        try {
            const devices = await window.db.devices.where('customer_id').equals(customerId).toArray();
            setCustomerDevices(devices);
            setDeviceSearchResults(devices);
        } catch (e) { console.error(e); }
    };

    const openEditModal = (order) => {
        setModalMode('edit');
        setFormData({
            id: order.id, customer_id: order.customer_id, device_id: order.device_id,
            maintenance_type: order.maintenance_type, issue_description: order.issue_description || '',
            technician_id: order.technician_id || '', estimated_cost: order.estimated_cost || ''
        });
        setCustomerSearchText(order.customer_name);
        setDeviceSearchText(`${order.device_type} ${order.brand ? order.brand : ''}`.trim());
        fetchCustomerDevices(order.customer_id);
        setShowModal(true);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        if (!formData.customer_id) return showToast("الرجاء اختيار العميل من القائمة", "error");
        if (!formData.device_id) return showToast("الرجاء اختيار الجهاز من القائمة", "error");

        setIsUpdating(true);
        try {
            const payload = {
                customer_id: formData.customer_id,
                device_id: formData.device_id,
                technician_id: formData.technician_id ? parseInt(formData.technician_id) : null,
                maintenance_type: formData.maintenance_type,
                issue_description: formData.issue_description,
                estimated_cost: parseFloat(formData.estimated_cost) || 0,
            };

            if (modalMode === 'add') {
                payload.status = 'قيد الفحص';
                payload.created_at = new Date().toISOString();
                await window.db.maintenance_requests.add(payload);
                showToast("تم إنشاء أمر الشغل بنجاح", "success");
            } else {
                await window.db.maintenance_requests.update(formData.id, payload);
                showToast("تم تحديث أمر الشغل بنجاح", "success");
            }
            
            setShowModal(false);
            fetchOrders(modalMode === 'add' ? 1 : pagination.current_page, activeTab, searchQuery);
        } catch (e) { 
            showToast("خطأ في الحفظ", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    // Live Search العملاء
    const handleCustomerSearchChange = (e) => {
        const value = e.target.value;
        setCustomerSearchText(value);
        if(formData.customer_id) {
            setFormData({...formData, customer_id: '', device_id: ''});
            setCustomerDevices([]); setDeviceSearchResults([]); setDeviceSearchText('');
        }
        if (value.trim().length < 2) { setCustomerSearchResults([]); setShowCustomerDropdown(false); return; }

        setIsSearchingCustomers(true); setShowCustomerDropdown(true);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const query = value.toLowerCase().trim();
                const customers = await window.db.customers
                    .filter(c => {
                        const name = c.name ? String(c.name).toLowerCase() : '';
                        const phone = c.phone ? String(c.phone) : '';
                        return name.includes(query) || phone.includes(query);
                    }).limit(5).toArray();
                setCustomerSearchResults(customers);
            } catch (error) { console.error("خطأ"); } 
            finally { setIsSearchingCustomers(false); }
        }, 300);
    };

    const selectCustomer = (customer) => {
        setCustomerSearchText(customer.name);
        setFormData({...formData, customer_id: customer.id, device_id: ''});
        setDeviceSearchText(''); setShowCustomerDropdown(false);
        fetchCustomerDevices(customer.id);
    };

    const handleDeviceSearchChange = (e) => {
        const value = e.target.value;
        setDeviceSearchText(value);
        if(formData.device_id) setFormData({...formData, device_id: ''});

        if (value.trim() === '') setDeviceSearchResults(customerDevices);
        else {
            const filtered = customerDevices.filter(d => 
                (d.device_type && d.device_type.toLowerCase().includes(value.toLowerCase())) ||
                (d.brand && d.brand.toLowerCase().includes(value.toLowerCase()))
            );
            setDeviceSearchResults(filtered);
        }
        setShowDeviceDropdown(true);
    };

    const selectDevice = (device) => {
        setDeviceSearchText(`${device.device_type} ${device.brand ? device.brand : ''}`.trim());
        setFormData({...formData, device_id: device.id});
        setShowDeviceDropdown(false);
    };

    // =========================================================================
    // دوال قطع الغيار (إضافة، حذف، قراءة السعر بذكاء)
    // =========================================================================
    const openPartsModal = async (order) => {
        setSelectedOrderForParts(order);
        setPartForm({ part_id: '', quantity: 1, max_qty: 1, price: 0 });
        setPartSearchText('');
        setShowPartsModal(true);
        loadPartsData(order.id);
    };

    const loadPartsData = async (orderId) => {
        setIsPartsLoading(true);
        try {
            const used = await window.db.used_items.where('request_id').equals(orderId).toArray();
            
            for(let item of used) {
                if(item.item_type === 'part') {
                    const part = await window.db.inventory_parts.get(item.part_id);
                    item.part_name = part ? part.part_name : 'قطعة محذوفة';
                    // قراءة السعر من الفاتورة أولاً، وإن لم يوجد نقرأه من بيانات القطعة الحالية
                    const fallbackPrice = part ? (Number(part.selling_price) || Number(part.price) || 0) : 0;
                    const finalItemPrice = item.price !== undefined && item.price !== null ? Number(item.price) : fallbackPrice;
                    
                    item.price = finalItemPrice;
                    item.total_price = item.total_price !== undefined && item.total_price !== null 
                        ? Number(item.total_price) 
                        : (finalItemPrice * item.quantity);
                }
            }
            setUsedParts(used);
        } catch (e) { 
            showToast("خطأ في جلب بيانات الفاتورة", "error"); 
        } finally { 
            setIsPartsLoading(false); 
        }
    };

    const handlePartSearchChange = (e) => {
        const value = e.target.value;
        setPartSearchText(value);
        
        if(partForm.part_id) setPartForm({ ...partForm, part_id: '' });
        if (value.trim().length < 2) { setPartSearchResults([]); setShowPartDropdown(false); return; }

        setIsSearchingParts(true); setShowPartDropdown(true);
        if (partSearchTimeoutRef.current) clearTimeout(partSearchTimeoutRef.current);
        
        partSearchTimeoutRef.current = setTimeout(async () => {
            try {
                const query = value.toLowerCase().trim();
                const parts = await window.db.inventory_parts
                    .filter(p => {
                        const name = p.part_name ? String(p.part_name).toLowerCase() : '';
                        const sku = p.sku ? String(p.sku).toLowerCase() : '';
                        return (name.includes(query) || sku.includes(query)) && p.stock_quantity > 0;
                    }).limit(5).toArray();
                setPartSearchResults(parts);
            } catch (error) { console.error("خطأ"); } 
            finally { setIsSearchingParts(false); }
        }, 300);
    };

    const selectPart = (part) => {
        // قراءة سعر البيع أولاً ثم تكلفة الشراء كبديل
        const actualPrice = Number(part.selling_price) || Number(part.price) || 0;
        setPartSearchText(`${part.part_name} - ${actualPrice} ج.م`);
        setPartForm({ part_id: part.id, quantity: 1, max_qty: part.stock_quantity, price: actualPrice });
        setShowPartDropdown(false);
    };

    const handleAddPart = async (e) => {
        e.preventDefault();
        if(!partForm.part_id) return showToast("الرجاء اختيار قطعة من القائمة", "error");
        if(partForm.quantity > partForm.max_qty) return showToast("الكمية المطلوبة أكبر من المتوفر بالمخزن", "error");
        
        setIsUpdating(true);
        try {
            // استخدام Transaction مباشرة لضمان حفظ القطعة بسعرها الصحيح وخصمها من المخزن
            await window.db.transaction('rw', window.db.used_items, window.db.inventory_parts, window.db.stock_movements, async () => {
                const qty = parseInt(partForm.quantity);
                const unitPrice = parseFloat(partForm.price) || 0;
                const totalPrice = unitPrice * qty;

                // 1. إضافة القطعة للطلب وتسجيل السعر الفعلي لها
                await window.db.used_items.add({
                    request_id: selectedOrderForParts.id,
                    item_type: 'part',
                    part_id: partForm.part_id,
                    service_id: null,
                    quantity: qty,
                    price: unitPrice,
                    total_price: totalPrice,
                    created_at: new Date().toISOString()
                });

                // 2. خصم من المخزن
                const part = await window.db.inventory_parts.get(partForm.part_id);
                await window.db.inventory_parts.update(part.id, {
                    stock_quantity: part.stock_quantity - qty
                });

                // 3. تسجيل حركة المخزن
                await window.db.stock_movements.add({
                    part_id: part.id,
                    user_id: userId,
                    movement_type: 'سحب لصيانة',
                    quantity: qty,
                    created_at: new Date().toISOString()
                });
            });

            showToast("تم خصم القطعة من المخزن وإضافتها للطلب بنجاح", "success");
            setPartForm({ part_id: '', quantity: 1, max_qty: 1, price: 0 });
            setPartSearchText(''); 
            loadPartsData(selectedOrderForParts.id); 
        } catch (e) { 
            console.error("Add Part Error:", e);
            showToast("حدث خطأ أثناء إضافة القطعة", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    const handleRemovePart = async (usedItem) => {
        if(!confirm("هل أنت متأكد من حذف القطعة وإرجاعها للمخزن؟ سيتم خصمها من الفاتورة أيضاً.")) return;
        setIsUpdating(true);
        try {
            await window.db.transaction('rw', window.db.used_items, window.db.inventory_parts, window.db.stock_movements, async () => {
                const part = await window.db.inventory_parts.get(usedItem.part_id);
                if(part) {
                    await window.db.inventory_parts.update(part.id, { stock_quantity: part.stock_quantity + usedItem.quantity });
                    await window.db.stock_movements.add({
                        part_id: part.id, user_id: userId, movement_type: 'إرجاع من صيانة', quantity: usedItem.quantity, created_at: new Date().toISOString()
                    });
                }
                await window.db.used_items.delete(usedItem.id);
            });

            showToast("تم إرجاع القطعة للمخزن بنجاح", "success");
            loadPartsData(selectedOrderForParts.id);
        } catch (e) { 
            showToast("خطأ في الاتصال", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    const getStatusStyle = (status) => {
        const styles = {
            'قيد الفحص': { color: 'bg-yellow-100 text-yellow-700', text: 'قيد الفحص', icon: 'fa-clock' },
            'جاري العمل': { color: 'bg-blue-100 text-blue-700', text: 'جاري العمل', icon: 'fa-spinner fa-spin' },
            'بانتظار قطع غيار': { color: 'bg-orange-100 text-orange-700', text: 'بانتظار قطع', icon: 'fa-pause' },
            'تم الإصلاح': { color: 'bg-emerald-100 text-emerald-700', text: 'تم الإصلاح', icon: 'fa-check-double' },
            'تم التسليم': { color: 'bg-purple-100 text-purple-700', text: 'تم التسليم', icon: 'fa-handshake' },
            'مرفوض / لا يمكن إصلاحه': { color: 'bg-rose-100 text-rose-700', text: 'مرفوض', icon: 'fa-ban' }
        };
        return styles[status] || { color: 'bg-slate-100 text-slate-700', text: status, icon: 'fa-circle' };
    };

    return (
        <div className="pb-24 md:pb-8 w-full max-w-7xl mx-auto space-y-6 animate-view relative">
            
            {/* الهيدر العلوي */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shrink-0">
                        <i className="fa-solid fa-wrench"></i>
                    </div>
                    <div>
                        <h2 className="font-black text-slate-800 text-lg">إدارة أوامر الشغل</h2>
                        <p className="text-[10px] md:text-xs font-bold text-slate-400">تتبع وإضافة وتعديل طلبات الصيانة لعملائك.</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
                    <form onSubmit={handleSearch} className="relative w-full sm:w-64">
                        <input type="text" placeholder="بحث برقم الطلب، العميل..." className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:border-blue-500 transition-all font-bold" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        <button type="submit" className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"><i className="fa-solid fa-magnifying-glass"></i></button>
                    </form>
                    
                    <button onClick={openAddModal} className="bg-gradient-to-r from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-black text-sm transition-colors shadow-md flex items-center justify-center gap-2 shrink-0">
                        <i className="fa-solid fa-plus"></i> أمر شغل جديد
                    </button>
                </div>
            </div>

            {/* فلاتر الحالة */}
            <div className="flex overflow-x-auto hide-scrollbar gap-2 pb-2">
                {[
                    { id: 'الكل', text: 'جميع الطلبات', icon: 'fa-list' },
                    { id: 'قيد الفحص', text: 'قيد الفحص', icon: 'fa-clock' },
                    { id: 'جاري العمل', text: 'جاري العمل', icon: 'fa-spinner' },
                    { id: 'بانتظار قطع غيار', text: 'بانتظار قطع', icon: 'fa-pause' },
                    { id: 'تم الإصلاح', text: 'تم الإصلاح', icon: 'fa-check-double' },
                    { id: 'تم التسليم', text: 'تم التسليم', icon: 'fa-handshake' }
                ].map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 shrink-0 transition-all ${activeTab === tab.id ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                        <i className={`fa-solid ${tab.icon}`}></i> {tab.text}
                    </button>
                ))}
            </div>

            {/* جدول البيانات الرئيسي */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative">
                {(isLoading || isUpdating) && !showModal && !showPartsModal && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                        <i className="fas fa-circle-notch fa-spin text-4xl text-[#06B6D4]"></i>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                        <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                            <tr>
                                <th className="p-4 whitespace-nowrap">رقم الطلب</th>
                                <th className="p-4 whitespace-nowrap">العميل / الجهاز</th>
                                <th className="p-4 whitespace-nowrap">العطل</th>
                                <th className="p-4 whitespace-nowrap">النوع</th>
                                <th className="p-4 whitespace-nowrap">الفني المسؤول</th>
                                <th className="p-4 whitespace-nowrap">الحالة</th>
                                <th className="p-4 whitespace-nowrap text-center">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {orders?.length > 0 ? orders.map((order) => {
                                const status = getStatusStyle(order.status);
                                return (
                                    <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-4 font-black text-slate-700">#{order.id}</td>
                                        <td className="p-4">
                                            <p className="font-bold text-slate-800">{order.customer_name}</p>
                                            <p className="text-[10px] font-semibold text-slate-400 mt-0.5">{order.device_type} {order.brand ? `(${order.brand})` : ''}</p>
                                        </td>
                                        <td className="p-4"><p className="font-semibold text-slate-600 w-48 truncate" title={order.issue_description}>{order.issue_description || 'لم يتم تسجيل وصف'}</p></td>
                                        <td className="p-4">
                                            {order.maintenance_type === 'داخلي' 
                                                ? <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md"><i className="fa-solid fa-shop"></i> داخلي</span>
                                                : <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md"><i className="fa-solid fa-truck-fast"></i> خارجي</span>
                                            }
                                        </td>
                                        <td className="p-4 font-bold text-slate-700">
                                            {order.technician_name ? <span className="flex items-center gap-1.5 text-xs"><i className="fa-solid fa-user-gear text-slate-400"></i> {order.technician_name}</span> : <span className="text-slate-400 text-[10px] bg-slate-50 px-2 py-1 border border-slate-100 rounded">لم يُحدد</span>}
                                        </td>
                                        <td className="p-4"><span className={`px-3 py-1 rounded-lg text-[10px] font-black flex items-center gap-1.5 w-max border ${status.color.replace('text', 'border').replace('100', '200')} ${status.color}`}><i className={`fa-solid ${status.icon}`}></i> {status.text}</span></td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                
                                                {/* زر إدارة قطع الغيار والفاتورة */}
                                                {order.status !== 'مرفوض / لا يمكن إصلاحه' && order.status !== 'تم التسليم' && (
                                                    <button onClick={() => openPartsModal(order)} className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-600 hover:text-white transition-colors border border-purple-100 shadow-sm" title="سحب قطع غيار من المخزن">
                                                        <i className="fa-solid fa-boxes-stacked text-xs"></i>
                                                    </button>
                                                )}

                                                {/* أزرار الحالات */}
                                                {order.status === 'قيد الفحص' && <button onClick={() => handleStatusChange(order.id, 'جاري العمل')} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors" title="البدء في العمل"><i className="fa-solid fa-play text-xs"></i></button>}
                                                {order.status === 'جاري العمل' && (
                                                    <>
                                                        <button onClick={() => handleStatusChange(order.id, 'بانتظار قطع غيار')} className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white transition-colors" title="تعليق العمل - بانتظار قطع غيار"><i className="fa-solid fa-pause text-xs"></i></button>
                                                        <button onClick={() => handleStatusChange(order.id, 'تم الإصلاح')} className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-colors" title="إنهاء الصيانة"><i className="fa-solid fa-check text-xs"></i></button>
                                                    </>
                                                )}
                                                {order.status === 'بانتظار قطع غيار' && <button onClick={() => handleStatusChange(order.id, 'جاري العمل')} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors" title="استئناف العمل"><i className="fa-solid fa-play text-xs"></i></button>}
                                                {order.status === 'تم الإصلاح' && <button onClick={() => handleStatusChange(order.id, 'تم التسليم')} className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-colors" title="تسليم الجهاز للعميل وإصدار فاتورة"><i className="fa-solid fa-handshake text-xs"></i></button>}

                                                <button onClick={() => openEditModal(order)} className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-800 hover:text-white hover:border-slate-800 transition-colors shadow-sm" title="تعديل البيانات"><i className="fa-solid fa-pen text-xs"></i></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : <tr><td colSpan="7" className="p-10 text-center text-slate-400 font-bold">لا توجد أوامر شغل مطابقة.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {/* نظام التقليب (Pagination) */}
                {pagination.total_records > 0 && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <span className="text-[10px] font-bold text-slate-500">صفحة {pagination.current_page} من {pagination.last_page} (إجمالي: {pagination.total_records})</span>
                        <div className="flex gap-2">
                            <button onClick={() => fetchOrders(pagination.current_page + 1, activeTab, searchQuery)} disabled={pagination.current_page === pagination.last_page || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-right text-xs"></i></button>
                            <button onClick={() => fetchOrders(pagination.current_page - 1, activeTab, searchQuery)} disabled={pagination.current_page === 1 || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-left text-xs"></i></button>
                        </div>
                    </div>
                )}
            </div>

            {/* الإعلان الترويجي الاحترافي */}
            <div className="bg-gradient-to-r from-slate-900 to-[#0B1120] rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-2xl mt-8 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#06B6D4] opacity-10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="relative z-10 flex items-center gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#06B6D4] to-[#3B82F6] flex items-center justify-center text-white text-3xl shadow-lg shrink-0 transform -rotate-6">
                        <i className="fas fa-qrcode"></i>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-white font-black text-lg md:text-xl">تتبع بالـ Barcode وإشعارات واتساب!</h3>
                            <span className="bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm">PRO</span>
                        </div>
                        <p className="text-slate-400 text-xs font-semibold leading-relaxed max-w-lg">
                            في النسخة السحابية، يمكنك طباعة ملصق QR Code لكل جهاز يدخل الورشة، وسيقوم النظام بإرسال رسالة واتساب للعميل تلقائياً فور تغيير الحالة إلى "تم الإصلاح".
                        </p>
                    </div>
                </div>
                <a href="https://wa.me/201211934816" target="_blank" className="relative z-10 w-full md:w-auto bg-white hover:bg-slate-50 text-slate-900 font-black text-sm px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_5px_20px_rgba(255,255,255,0.15)] whitespace-nowrap">
                    <i className="fab fa-whatsapp text-[#25D366] text-lg"></i> احصل على النسخة PRO
                </a>
            </div>

            {/* ========================================== */}
            {/* 🌟 نافذة إدارة قطع الغيار والفاتورة (مع البحث الحي) 🌟 */}
            {/* ========================================== */}
            {showPartsModal && selectedOrderForParts && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center px-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPartsModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl z-10 overflow-hidden animate-view flex flex-col max-h-[90vh]">
                        
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-purple-50/50">
                            <div>
                                <h3 className="text-lg font-black text-purple-800">صرف قطع غيار - طلب #{selectedOrderForParts.id}</h3>
                                <p className="text-[10px] font-bold text-slate-500 mt-1">العميل: {selectedOrderForParts.customer_name} | {selectedOrderForParts.device_type}</p>
                            </div>
                            <button onClick={() => setShowPartsModal(false)} className="w-8 h-8 rounded-full bg-white text-slate-500 hover:bg-rose-500 hover:text-white shadow-sm border border-slate-200 flex items-center justify-center transition-colors">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto relative bg-slate-50 flex-1">
                            {isPartsLoading && <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex items-center justify-center"><i className="fas fa-circle-notch fa-spin text-3xl text-purple-600"></i></div>}

                            <div className="bg-white p-4 rounded-2xl border border-purple-100 shadow-sm mb-6">
                                <h4 className="text-xs font-black text-slate-800 mb-3"><i className="fa-solid fa-hand-holding-box text-purple-600"></i> سحب قطعة من المخزن وإضافتها للطلب:</h4>
                                <form onSubmit={handleAddPart} className="flex flex-col md:flex-row gap-3">
                                    
                                    <div className="flex-1 relative" ref={partDropdownRef}>
                                        <input 
                                            type="text" 
                                            required 
                                            className={`w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:border-purple-500 pr-10 ${partForm.part_id ? 'border-green-500 bg-green-50' : 'bg-slate-50'}`}
                                            placeholder="ابحث عن قطعة (حرفين على الأقل)..."
                                            value={partSearchText}
                                            onChange={handlePartSearchChange}
                                            onFocus={() => { if(partSearchResults?.length > 0) setShowPartDropdown(true); }}
                                        />
                                        <i className={`fa-solid ${isSearchingParts ? 'fa-spinner fa-spin text-purple-500' : (partForm.part_id ? 'fa-check text-green-500' : 'fa-magnifying-glass text-slate-400')} absolute left-3 top-1/2 -translate-y-1/2`}></i>
                                        
                                        {showPartDropdown && (
                                            <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                                                {partSearchResults?.length > 0 ? (
                                                    partSearchResults.map(p => {
                                                        const pPrice = Number(p.selling_price) || Number(p.price) || 0;
                                                        return (
                                                            <li key={p.id} onMouseDown={() => selectPart(p)} className="p-3 hover:bg-purple-50 cursor-pointer flex flex-col transition-colors text-right">
                                                                <span className="font-bold text-slate-800 text-sm">{p.part_name}</span>
                                                                <span className="text-[10px] text-emerald-600 font-bold mt-1">السعر: {pPrice.toLocaleString()} ج.م | المتوفر: <span className={p.stock_quantity > 0 ? 'text-blue-500' : 'text-rose-500'}>{p.stock_quantity}</span></span>
                                                            </li>
                                                        )
                                                    })
                                                ) : (
                                                    <li className="p-3 text-center text-sm font-bold text-slate-400">لا توجد قطع مطابقة بالمخزن</li>
                                                )}
                                            </ul>
                                        )}
                                    </div>

                                    <div className="w-full md:w-32">
                                        <input type="number" min="1" max={partForm.max_qty || 1} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-center text-slate-700 focus:outline-none focus:border-purple-500 bg-slate-50" placeholder="الكمية" value={partForm.quantity} onChange={(e) => setPartForm({...partForm, quantity: e.target.value})} />
                                    </div>
                                    <button type="submit" disabled={isUpdating} className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:opacity-90 text-white px-6 py-2.5 rounded-xl font-bold transition-colors shadow-md disabled:opacity-70 whitespace-nowrap text-sm">
                                        صرف وإضافة <i className="fa-solid fa-plus mr-1"></i>
                                    </button>
                                </form>
                            </div>

                            <h4 className="text-xs font-black text-slate-800 mb-3 px-1"><i className="fa-solid fa-list-check text-emerald-600"></i> القطع التي تم تركيبها بالفعل:</h4>
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <table className="w-full text-right text-sm">
                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 text-[11px]">
                                        <tr>
                                            <th className="p-3 whitespace-nowrap">اسم القطعة</th>
                                            <th className="p-3 whitespace-nowrap text-center">الكمية</th>
                                            <th className="p-3 whitespace-nowrap text-center">سعر الوحدة</th>
                                            <th className="p-3 whitespace-nowrap text-center">الإجمالي</th>
                                            <th className="p-3 whitespace-nowrap text-center">إرجاع</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {usedParts?.length > 0 ? usedParts.map(up => (
                                            <tr key={up.id}>
                                                <td className="p-3 font-bold text-slate-800 text-xs">{up.part_name}</td>
                                                <td className="p-3 font-black text-slate-600 text-center text-xs">{up.quantity}</td>
                                                <td className="p-3 font-bold text-slate-500 text-center text-xs">{Number(up.price).toLocaleString()}</td>
                                                <td className="p-3 font-black text-emerald-600 text-center text-xs">{Number(up.total_price).toLocaleString()}</td>
                                                <td className="p-3 text-center">
                                                    <button onClick={() => handleRemovePart(up)} disabled={isUpdating} className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-100 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors" title="حذف وإرجاع للمخزن">
                                                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        )) : <tr><td colSpan="5" className="p-6 text-center text-slate-400 font-bold text-xs">لم يتم سحب أي قطع غيار لهذا الطلب حتى الآن.</td></tr>}
                                    </tbody>
                                    {usedParts?.length > 0 && (
                                        <tfoot className="bg-slate-50 border-t border-slate-200 font-black">
                                            <tr>
                                                <td colSpan="3" className="p-3 text-left text-slate-600 text-xs">إجمالي قطع الغيار المُضافة للطلب:</td>
                                                <td className="p-3 text-center text-emerald-600 text-base">{usedParts.reduce((sum, item) => sum + parseFloat(item.total_price), 0).toLocaleString()} <span className="text-[9px]">ج.م</span></td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* نافذة الإضافة / التعديل الأساسية */}
            {/* ========================================== */}
            {showModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center px-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl z-10 overflow-hidden animate-view">
                        
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h3 className="text-lg font-black text-slate-800">
                                {modalMode === 'add' ? 'إضافة أمر شغل جديد' : `تعديل أمر الشغل #${formData.id}`}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-white text-slate-500 hover:bg-rose-500 hover:text-white border border-slate-200 shadow-sm flex items-center justify-center transition-colors">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto hide-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                
                                <div className="relative" ref={dropdownRef}>
                                    <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">العميل (بحث بالاسم أو الهاتف) <span className="text-rose-500">*</span></label>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            required 
                                            className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#06B6D4] pr-10 ${formData.customer_id ? 'border-green-500 bg-green-50' : ''}`}
                                            placeholder="اكتب للبحث..."
                                            value={customerSearchText}
                                            onChange={handleCustomerSearchChange}
                                            onFocus={() => { if(customerSearchResults?.length > 0) setShowCustomerDropdown(true); }}
                                        />
                                        <i className={`fa-solid ${isSearchingCustomers ? 'fa-spinner fa-spin text-[#06B6D4]' : (formData.customer_id ? 'fa-check text-green-500' : 'fa-magnifying-glass text-slate-400')} absolute left-4 top-1/2 -translate-y-1/2`}></i>
                                    </div>
                                    
                                    {showCustomerDropdown && (
                                        <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                                            {customerSearchResults?.length > 0 ? (
                                                customerSearchResults.map(c => (
                                                    <li key={c.id} onMouseDown={() => selectCustomer(c)} className="p-3 hover:bg-cyan-50 cursor-pointer flex flex-col transition-colors text-right">
                                                        <span className="font-bold text-slate-800 text-sm">{c.name}</span>
                                                        <span className="text-[10px] text-slate-400 font-bold">{c.phone}</span>
                                                    </li>
                                                ))
                                            ) : (
                                                <li className="p-3 text-center text-xs font-bold text-slate-400">لا توجد نتائج مطابقة</li>
                                            )}
                                        </ul>
                                    )}
                                </div>

                                <div className="relative" ref={deviceDropdownRef}>
                                    <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">الجهاز <span className="text-rose-500">*</span></label>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            required 
                                            disabled={!formData.customer_id}
                                            className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#06B6D4] pr-10 disabled:opacity-50 disabled:cursor-not-allowed ${formData.device_id ? 'border-green-500 bg-green-50' : ''}`}
                                            placeholder={formData.customer_id ? "اختر من أجهزة العميل..." : "الرجاء اختيار العميل أولاً"}
                                            value={deviceSearchText}
                                            onChange={handleDeviceSearchChange}
                                            onFocus={() => { if(formData.customer_id && customerDevices.length > 0) setShowDeviceDropdown(true); }}
                                        />
                                        <i className={`fa-solid ${formData.device_id ? 'fa-check text-green-500' : 'fa-laptop text-slate-400'} absolute left-4 top-1/2 -translate-y-1/2`}></i>
                                    </div>
                                    
                                    {formData.customer_id && (!customerDevices || customerDevices.length === 0) && (
                                        <p className="text-[10px] text-rose-500 mt-1.5 font-bold ml-1">هذا العميل ليس لديه أجهزة. أضفها من شاشة العملاء.</p>
                                    )}

                                    {showDeviceDropdown && formData.customer_id && (
                                        <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                                            {deviceSearchResults?.length > 0 ? (
                                                deviceSearchResults.map(d => (
                                                    <li key={d.id} onMouseDown={() => selectDevice(d)} className="p-3 hover:bg-cyan-50 cursor-pointer flex flex-col transition-colors text-right">
                                                        <span className="font-bold text-slate-800 text-sm">{d.device_type}</span>
                                                        {d.brand && <span className="text-[10px] text-slate-400 font-bold">{d.brand} {d.model}</span>}
                                                    </li>
                                                ))
                                            ) : (
                                                <li className="p-3 text-center text-xs font-bold text-slate-400">لا توجد أجهزة للعميل</li>
                                            )}
                                        </ul>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">نوع الصيانة <span className="text-rose-500">*</span></label>
                                    <select required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#06B6D4] appearance-none"
                                        value={formData.maintenance_type} onChange={(e) => setFormData({...formData, maintenance_type: e.target.value})}>
                                        <option value="داخلي">داخلي (في المركز)</option>
                                        <option value="خارجي">خارجي (عند العميل)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">الفني المسؤول (اختياري)</label>
                                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#06B6D4] appearance-none"
                                        value={formData.technician_id} onChange={(e) => setFormData({...formData, technician_id: e.target.value})}>
                                        <option value="">-- لم يتم التحديد بعد --</option>
                                        {technicians?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">وصف العطل / شكوى العميل <span className="text-rose-500">*</span></label>
                                <textarea required rows="2" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#06B6D4]" placeholder="اكتب تفاصيل العطل هنا..."
                                    value={formData.issue_description} onChange={(e) => setFormData({...formData, issue_description: e.target.value})}></textarea>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">مصنعية الصيانة المبدئية (بدون قطع الغيار)</label>
                                <div className="relative">
                                    <input type="number" min="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#06B6D4]" placeholder="0"
                                        value={formData.estimated_cost} onChange={(e) => setFormData({...formData, estimated_cost: e.target.value})} />
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px]">ج.م</span>
                                </div>
                            </div>

                            <div className="pt-2 flex gap-3">
                                <button type="submit" disabled={isUpdating} className="flex-1 bg-gradient-to-r from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white py-3.5 rounded-xl font-black transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-md active:scale-95 text-sm">
                                    {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
                                    {modalMode === 'add' ? 'إنشاء أمر الشغل' : 'حفظ التعديلات'}
                                </button>
                                <button type="button" onClick={() => setShowModal(false)} className="px-6 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl font-black transition-all active:scale-95 text-sm">
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};