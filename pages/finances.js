window.Module_Finances = function({ centerId, userId, showToast, setActiveModule }) {
    const { useState, useEffect, useRef } = React;
    
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    
    const [activeTab, setActiveTab] = useState('invoices'); 
    
    const [listData, setListData] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [stats, setStats] = useState({ revenue: 0, expenses: 0, profit: 0 });
    
    // حالات البحث والفلاتر
    const [searchText, setSearchText] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const searchTimeoutRef = useRef(null);

    // ==========================================
    // حالة النوافذ (Modals)
    // ==========================================
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [expenseModalMode, setExpenseModalMode] = useState('add'); 
    const initialExpenseForm = { id: null, expense_type: 'other', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0] };
    const [expenseForm, setExpenseForm] = useState(initialExpenseForm);

    const [showPayModal, setShowPayModal] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState('كاش');

    // حالات نافذة تعديل الفاتورة المتقدمة
    const [showEditInvoiceModal, setShowEditInvoiceModal] = useState(false);
    const [editInvoiceData, setEditInvoiceData] = useState(null);
    const [invoiceItems, setInvoiceItems] = useState([]);
    const [availableParts, setAvailableParts] = useState([]);
    const [availableServices, setAvailableServices] = useState([]);
    const [invoiceDiscount, setInvoiceDiscount] = useState(0);

    // ==========================================
    // دالة مساعدة لحماية ومعالجة التواريخ
    // ==========================================
    const safeFormatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return String(dateString).split('T')[0].split(' ')[0];
        } catch (e) {
            return '-';
        }
    };

    // ==========================================
    // دوال قاعدة البيانات المحلية (Dexie.js)
    // ==========================================
    
    const fetchStats = async () => {
        try {
            const allPayments = await window.db.payments.toArray();
            const totalRevenue = allPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

            const allExpenses = await window.db.expenses.toArray();
            const totalExpenses = allExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

            setStats({
                revenue: totalRevenue,
                expenses: totalExpenses,
                profit: totalRevenue - totalExpenses
            });
        } catch (e) { console.error("Error fetching financial stats", e); }
    };

    // دالة الجلب المحدثة (تدعم البحث النصي + نطاق التاريخ)
    const fetchData = async (page = 1, search = searchText, tab = activeTab, from = dateFrom, to = dateTo) => {
        setIsLoading(true);
        try {
            let paginatedItems = [];
            let total = 0;
            const perPage = 10; // تم تعديلها لـ 10 لعرض أفضل، يمكنك تغييرها إذا أردت

            if (tab === 'invoices') {
                let invoices = await window.db.invoices.toArray();
                invoices.reverse(); 
                
                for (let inv of invoices) {
                    if (inv.customer_id) {
                        const customerIdNum = Number(inv.customer_id);
                        const customer = await window.db.customers.get(customerIdNum);
                        inv.customer_name = customer ? customer.name : 'عميل غير مسجل';
                    } else {
                        inv.customer_name = 'عميل غير مسجل';
                    }
                    inv.display_invoice_number = inv.invoice_number || `INV-${String(inv.id).padStart(4, '0')}`;
                    inv.display_date = inv.created_at || inv.date || new Date().toISOString();
                }

                // 1. الفلترة النصية
                if (search.trim() !== '') {
                    const lowerSearch = search.toLowerCase();
                    invoices = invoices.filter(inv => 
                        (inv.display_invoice_number.toLowerCase().includes(lowerSearch)) || 
                        (inv.customer_name.toLowerCase().includes(lowerSearch))
                    );
                }

                // 2. الفلترة بالتاريخ (من - إلى)
                if (from || to) {
                    invoices = invoices.filter(inv => {
                        const invDate = safeFormatDate(inv.display_date);
                        if (invDate === '-') return false;
                        if (from && invDate < from) return false;
                        if (to && invDate > to) return false;
                        return true;
                    });
                }

                total = invoices.length;
                paginatedItems = invoices.slice((page - 1) * perPage, page * perPage);

            } else if (tab === 'expenses') {
                let expenses = await window.db.expenses.toArray();
                expenses.reverse();
                
                // 1. الفلترة النصية
                if (search.trim() !== '') {
                    const lowerSearch = search.toLowerCase();
                    expenses = expenses.filter(exp => 
                        (exp.description && exp.description.toLowerCase().includes(lowerSearch)) || 
                        (exp.expense_type && exp.expense_type.toLowerCase().includes(lowerSearch))
                    );
                }

                // 2. الفلترة بالتاريخ (من - إلى)
                if (from || to) {
                    expenses = expenses.filter(exp => {
                        const expDate = safeFormatDate(exp.date || exp.expense_date);
                        if (expDate === '-') return false;
                        if (from && expDate < from) return false;
                        if (to && expDate > to) return false;
                        return true;
                    });
                }

                total = expenses.length;
                paginatedItems = expenses.slice((page - 1) * perPage, page * perPage);
            }

            setListData(paginatedItems);
            setPagination({ 
                current_page: page, 
                last_page: Math.ceil(total / perPage) || 1, 
                total: total 
            });

        } catch (error) { 
            showToast("حدث خطأ في قراءة البيانات", "error"); 
        } finally { 
            setIsLoading(false); 
        }
    };

    useEffect(() => {
        fetchData(1, searchText, activeTab, dateFrom, dateTo);
    }, [activeTab]);

    useEffect(() => {
        fetchStats();
    }, []);

    // دوال التعامل مع البحث وتغيير التواريخ
    const handleSearchChange = (e) => {
        const val = e.target.value;
        setSearchText(val);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            fetchData(1, val, activeTab, dateFrom, dateTo);
        }, 400);
    };

    const handleDateFromChange = (e) => {
        const val = e.target.value;
        setDateFrom(val);
        fetchData(1, searchText, activeTab, val, dateTo);
    };

    const handleDateToChange = (e) => {
        const val = e.target.value;
        setDateTo(val);
        fetchData(1, searchText, activeTab, dateFrom, val);
    };

    const clearDateFilters = () => {
        setDateFrom('');
        setDateTo('');
        fetchData(1, searchText, activeTab, '', '');
    };

    // ==========================================
    // معالجة المصروفات
    // ==========================================
    const openAddExpense = () => {
        setExpenseModalMode('add');
        setExpenseForm(initialExpenseForm);
        setShowExpenseModal(true);
    };

    const openEditExpense = (exp) => {
        setExpenseModalMode('edit');
        setExpenseForm({ 
            id: exp.id, 
            expense_type: exp.expense_type, 
            description: exp.description || '', 
            amount: exp.amount, 
            expense_date: safeFormatDate(exp.date || exp.expense_date)
        });
        setShowExpenseModal(true);
    };

    const handleExpenseSubmit = async (e) => {
        e.preventDefault();
        setIsUpdating(true);
        try {
            if (expenseModalMode === 'add') {
                await window.CenterQueries.addExpense(expenseForm.amount, expenseForm.expense_type, expenseForm.description, expenseForm.expense_date);
                showToast("تم تسجيل المصروف بنجاح", "success");
            } else {
                await window.db.expenses.update(expenseForm.id, { expense_type: expenseForm.expense_type, amount: Number(expenseForm.amount), date: expenseForm.expense_date, description: expenseForm.description });
                showToast("تم تحديث المصروف", "success");
            }
            setShowExpenseModal(false);
            fetchStats();
            if(activeTab === 'expenses') fetchData(expenseModalMode === 'add' ? 1 : pagination.current_page, searchText, 'expenses', dateFrom, dateTo);
        } catch (e) { 
            showToast("حدث خطأ أثناء الحفظ", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    // ==========================================
    // تعديل الفاتورة الاحترافي (مع قطع الغيار والمخزن)
    // ==========================================
    const openEditInvoice = async (inv) => {
        setIsLoading(true);
        try {
            const parts = await window.db.inventory_parts.toArray();
            const services = await window.db.service_catalog.toArray();
            setAvailableParts(parts);
            setAvailableServices(services);

            setEditInvoiceData(inv);
            
            let currentDiscount = 0;
            if (inv.total_amount && inv.final_amount) {
                currentDiscount = Number(inv.total_amount) - Number(inv.final_amount);
            }
            setInvoiceDiscount(currentDiscount >= 0 ? currentDiscount : 0);

            if (inv.request_id) {
                const used = await window.db.used_items.where('request_id').equals(inv.request_id).toArray();
                const mappedItems = used.map(u => ({
                    id: `old_${u.id}`,
                    is_new: false,
                    db_id: u.id,
                    item_type: u.item_type,
                    item_id: u.item_type === 'part' ? u.part_id : u.service_id,
                    quantity: u.quantity,
                    price: Number(u.price || 0)
                }));
                setInvoiceItems(mappedItems);
            } else {
                setInvoiceItems([]);
            }

            setShowEditInvoiceModal(true);
        } catch (e) {
            console.error(e);
            showToast("تعذر جلب تفاصيل الفاتورة", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const addInvoiceItemRow = () => {
        setInvoiceItems([...invoiceItems, {
            id: `new_${Date.now()}`,
            is_new: true,
            item_type: 'part',
            item_id: '',
            quantity: 1,
            price: 0
        }]);
    };

    const removeInvoiceItemRow = (index) => {
        const newItems = [...invoiceItems];
        newItems.splice(index, 1);
        setInvoiceItems(newItems);
    };

    const handleInvoiceItemChange = (index, field, value) => {
        const newItems = [...invoiceItems];
        newItems[index][field] = value;

        if (field === 'item_id' || field === 'item_type') {
            const type = newItems[index].item_type;
            const id = Number(newItems[index].item_id);
            if (type === 'part') {
                const p = availableParts.find(x => x.id === id);
                if (p) newItems[index].price = Number(p.selling_price || p.price || 0);
            } else if (type === 'service') {
                const s = availableServices.find(x => x.id === id);
                if (s) newItems[index].price = Number(s.price || 0);
            }
        }
        setInvoiceItems(newItems);
    };

    const getInvoiceEditTotals = () => {
        const subTotal = invoiceItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);
        const finalTotal = subTotal - Number(invoiceDiscount);
        return { subTotal, finalTotal: finalTotal > 0 ? finalTotal : 0 };
    };

    const handleSaveInvoiceEdit = async (e) => {
        e.preventDefault();
        
        if(editInvoiceData.status === 'مدفوعة') {
            if(!confirm("تحذير: هذه الفاتورة تم تحصيلها مسبقاً! تعديل الفاتورة قد يسبب اختلافاً في الحسابات النقدية. هل تريد الاستمرار؟")) return;
        }

        setIsUpdating(true);
        try {
            const reqId = editInvoiceData.request_id;
            
            if (reqId) {
                const oldUsedItems = await window.db.used_items.where('request_id').equals(reqId).toArray();
                for (let old of oldUsedItems) {
                    if (old.item_type === 'part' && old.part_id) {
                        const p = await window.db.inventory_parts.get(Number(old.part_id));
                        if (p) {
                            await window.db.inventory_parts.update(p.id, { quantity: Number(p.quantity) + Number(old.quantity) });
                        }
                    }
                }

                await window.db.used_items.where('request_id').equals(reqId).delete();

                for (let item of invoiceItems) {
                    if (!item.item_id) continue; 
                    
                    await window.db.used_items.add({
                        request_id: reqId,
                        item_type: item.item_type,
                        part_id: item.item_type === 'part' ? Number(item.item_id) : null,
                        service_id: item.item_type === 'service' ? Number(item.item_id) : null,
                        quantity: Number(item.quantity),
                        price: Number(item.price)
                    });

                    if (item.item_type === 'part' && item.item_id) {
                        const p = await window.db.inventory_parts.get(Number(item.item_id));
                        if (p) {
                            await window.db.inventory_parts.update(p.id, { quantity: Number(p.quantity) - Number(item.quantity) });
                        }
                    }
                }
            }

            const totals = getInvoiceEditTotals();
            await window.db.invoices.update(editInvoiceData.id, {
                total_amount: totals.subTotal,
                final_amount: totals.finalTotal,
                discount: Number(invoiceDiscount)
            });

            if(reqId) {
                await window.db.maintenance_requests.update(reqId, { cost: totals.finalTotal });
            }

            showToast("تم تعديل الفاتورة وتحديث المخزن بنجاح", "success");
            setShowEditInvoiceModal(false);
            fetchStats();
            fetchData(pagination.current_page, searchText, 'invoices', dateFrom, dateTo);

        } catch (e) {
            console.error(e);
            showToast("حدث خطأ أثناء تعديل الفاتورة", "error");
        } finally {
            setIsUpdating(false);
        }
    };

    // ==========================================
    // تحصيل وطباعة الفواتير
    // ==========================================
    const openPayModal = (invoice) => {
        setSelectedInvoice(invoice);
        setPaymentMethod('كاش');
        setShowPayModal(true);
    };

    const handlePaySubmit = async (e) => {
        e.preventDefault();
        setIsUpdating(true);
        try {
            const finalAmount = selectedInvoice.final_amount || selectedInvoice.total_amount;
            await window.CenterQueries.payInvoice(selectedInvoice.id, finalAmount, paymentMethod);
            
            showToast("تم تحصيل الفاتورة بنجاح", "success");
            setShowPayModal(false);
            fetchStats();
            fetchData(pagination.current_page, searchText, 'invoices', dateFrom, dateTo);
        } catch (e) { 
            showToast("حدث خطأ أثناء التحصيل", "error"); 
        } finally { 
            setIsUpdating(false); 
        }
    };

    const handlePrintInvoice = async (invoiceId) => {
        setIsLoading(true);
        try {
            const inv = await window.db.invoices.get(Number(invoiceId));
            if(!inv) throw new Error("الفاتورة غير موجودة");

            const centerInfoArray = await window.db.center_info.toArray();
            const centerName = centerInfoArray.length > 0 ? centerInfoArray[0].name : "مركز الصيانة";

            const customer = inv.customer_id ? await window.db.customers.get(Number(inv.customer_id)) : { name: '', phone: '' };
            const request = inv.request_id ? await window.db.maintenance_requests.get(Number(inv.request_id)) : null;
            const device = request && request.device_id ? await window.db.devices.get(Number(request.device_id)) : { device_type: '', brand: '', model: '' };

            let items = [];
            if (request) {
                const usedItems = await window.db.used_items.where('request_id').equals(request.id).toArray();
                for(let u of usedItems) {
                    let itemName = "عنصر غير معروف";
                    let price = 0;

                    if (u.item_type === 'part' && u.part_id) {
                        const part = await window.db.inventory_parts.get(Number(u.part_id));
                        if(part) { itemName = part.part_name; price = Number(part.selling_price || part.price) || 0; }
                    } else if (u.item_type === 'service' && u.service_id) {
                        const srv = await window.db.service_catalog.get(Number(u.service_id));
                        if(srv) { itemName = srv.name; price = Number(srv.price) || 0; }
                    }

                    items.push({
                        item_name: itemName,
                        quantity: u.quantity,
                        price: u.price || price,
                        total_price: (u.price || price) * u.quantity
                    });
                }
            }

            const printInvoiceNumber = inv.invoice_number || `INV-${String(inv.id).padStart(4, '0')}`;
            const printDate = safeFormatDate(inv.created_at || inv.date || new Date().toISOString());

            const printData = {
                center_name: centerName,
                invoice: {
                    invoice_number: printInvoiceNumber,
                    created_at: printDate,
                    status: inv.status,
                    customer_name: customer ? customer.name : '',
                    customer_phone: customer ? customer.phone : '',
                    device_type: device ? device.device_type : '',
                    brand: device ? device.brand : '',
                    model: device ? device.model : '',
                    total_amount: inv.total_amount,
                    discount: (inv.total_amount - (inv.final_amount || inv.total_amount)) || 0,
                    final_amount: inv.final_amount || inv.total_amount,
                    issue_description: request ? request.issue_description : '',
                },
                items: items
            };

            generatePrintTemplate(printData);

        } catch (e) { 
            showToast(e.message || "حدث خطأ أثناء التجهيز للطباعة", "error"); 
        } finally { 
            setIsLoading(false); 
        }
    };

    const generatePrintTemplate = (data) => {
        const inv = data.invoice;
        const items = data.items || [];
        const printWindow = window.open('', '_blank');
        
        let itemsHTML = '';
        if(items.length > 0) {
            items.forEach((item, index) => {
                itemsHTML += `
                    <tr>
                        <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${index + 1}</td>
                        <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${item.item_name}</td>
                        <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${item.quantity}</td>
                        <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${item.price}</td>
                        <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold;">${item.total_price}</td>
                    </tr>
                `;
            });
        } else {
            itemsHTML = `<tr><td colspan="5" style="padding: 15px; text-align: center; color: #64748b;">قيمة إجمالية تقديرية لعملية الصيانة</td></tr>`;
        }

        const isPaid = inv.status === 'مدفوعة';

        const html = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>فاتورة رقم ${inv.invoice_number}</title>
                <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Cairo', sans-serif; color: #1e293b; margin: 0; padding: 40px; background: #fff; }
                    .invoice-container { max-width: 800px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #06b6d4; padding-bottom: 20px; margin-bottom: 30px; }
                    .header h1 { margin: 0; color: #06b6d4; font-size: 28px; font-weight: 900; }
                    .header p { margin: 5px 0 0; color: #64748b; font-size: 14px; }
                    .invoice-details { text-align: left; }
                    .invoice-details h2 { margin: 0; font-size: 20px; color: #334155; }
                    .invoice-details p { margin: 5px 0 0; font-size: 14px; font-weight: bold; }
                    
                    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                    .info-box { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #f1f5f9; }
                    .info-box h3 { margin: 0 0 10px; font-size: 14px; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
                    .info-box p { margin: 5px 0; font-size: 14px; font-weight: bold; }
                    
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                    th { background: #06b6d4; color: #fff; padding: 12px; text-align: right; }
                    
                    .total-box { display: flex; justify-content: flex-end; }
                    .total-content { width: 300px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
                    .total-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px; font-weight: bold; }
                    .discount-row { color: #f43f5e; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 10px; }
                    .total-row.final { font-size: 20px; color: #06b6d4; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 10px; }
                    
                    .footer { margin-top: 50px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
                    
                    @media print { body { padding: 0; } .invoice-container { border: none; padding: 0; max-width: 100%; } }
                </style>
            </head>
            <body>
                <div class="invoice-container">
                    <div class="header">
                        <div>
                            <h1>${data.center_name}</h1>
                            <p>نظام مينترا لإدارة مراكز الصيانة</p>
                        </div>
                        <div class="invoice-details">
                            <h2>فاتورة صيانة</h2>
                            <p>رقم الفاتورة: <span dir="ltr">${inv.invoice_number}</span></p>
                            <p>التاريخ: <span dir="ltr">${inv.created_at}</span></p>
                            <p>الحالة: <span style="color: ${isPaid ? '#10b981' : '#f43f5e'};">${inv.status}</span></p>
                        </div>
                    </div>

                    <div class="info-grid">
                        <div class="info-box">
                            <h3>بيانات العميل</h3>
                            <p>الاسم: ${inv.customer_name}</p>
                            <p>الهاتف: ${inv.customer_phone}</p>
                        </div>
                        <div class="info-box">
                            <h3>بيانات الجهاز</h3>
                            <p>الجهاز: ${inv.device_type || 'غير محدد'}</p>
                            <p>الماركة/الموديل: ${inv.brand || ''} ${inv.model || ''}</p>
                            <p>الشكوى: ${inv.issue_description || 'لا يوجد'}</p>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th style="width: 50px; text-align: center;">#</th>
                                <th>البيان (قطع الغيار / الخدمات)</th>
                                <th style="width: 100px; text-align: center;">الكمية</th>
                                <th style="width: 150px; text-align: center;">سعر الوحدة</th>
                                <th style="width: 150px; text-align: center;">الإجمالي</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHTML}
                        </tbody>
                    </table>

                    <div class="total-box">
                        <div class="total-content">
                            <div class="total-row"><span>الإجمالي:</span> <span>${inv.total_amount} ج.م</span></div>
                            ${inv.discount > 0 ? `<div class="total-row discount-row"><span>الخصم:</span> <span>- ${inv.discount} ج.م</span></div>` : ''}
                            <div class="total-row final"><span>الصافي المطلوب:</span> <span>${inv.final_amount} ج.م</span></div>
                        </div>
                    </div>

                    <div class="footer">
                        هذه الفاتورة تم إصدارها إلكترونياً. شكراً لثقتكم بنا!
                    </div>
                </div>
                <script>
                    window.onload = function() {
                        setTimeout(() => { window.print(); }, 500);
                    }
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
    };

    const getInvoiceStatusUI = (status) => {
        const maps = {
            'غير مدفوعة': { text: 'غير مدفوعة', color: 'bg-rose-50 text-rose-600 border border-rose-100' },
            'مدفوعة': { text: 'مدفوعة', color: 'bg-emerald-50 text-emerald-600 border border-emerald-100' },
            'ملغاة': { text: 'ملغاة', color: 'bg-slate-50 text-slate-500 border border-slate-200' }
        };
        return maps[status] || maps['غير مدفوعة'];
    };

    const getExpenseTypeName = (type) => {
        const maps = { 'rent': 'إيجار', 'salaries': 'رواتب', 'utilities': 'مرافق (كهرباء/ماء)', 'equipment': 'معدات/أدوات', 'transportation': 'انتقالات', 'other': 'أخرى' };
        if(Object.values(maps).includes(type)) return type;
        return maps[type] || type;
    };

    return (
        <div className="space-y-6 relative pb-10">
            
            {/* الهيدر العلوي المطور (مع الفلاتر) */}
            <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-100 space-y-4">
                
                {/* الجزء العلوي: العنوان وزر الإضافة */}
                <div className="flex flex-col lg:flex-row justify-between gap-4 items-start lg:items-center">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center text-cyan-600"><i className="fa-solid fa-file-invoice-dollar"></i></div>
                            الحسابات والمصروفات
                        </h2>
                        <p className="text-slate-500 text-sm font-bold mt-2">تتبع إيرادات أوامر الشغل، سجل المصروفات، وابحث بالنطاق الزمني.</p>
                    </div>
                    <button onClick={openAddExpense} className="bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-500 hover:text-white px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shrink-0">
                        <i className="fa-solid fa-plus"></i> تسجيل مصروف
                    </button>
                </div>

                {/* الجزء السفلي: شريط البحث وفلاتر التاريخ */}
                <div className="flex flex-col md:flex-row gap-3 pt-4 border-t border-slate-100">
                    <div className="relative flex-1">
                        <input type="text" placeholder={activeTab === 'invoices' ? "بحث برقم الفاتورة أو العميل..." : "بحث في المصروفات..."} className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-cyan-500 transition-all font-bold" value={searchText} onChange={handleSearchChange} />
                        <i className="fa-solid fa-magnifying-glass absolute top-1/2 right-4 -translate-y-1/2 text-slate-400"></i>
                    </div>
                    
                    <div className="flex flex-row gap-2 flex-1 md:flex-none">
                        <div className="relative w-full md:w-36">
                            <span className="absolute -top-2.5 right-3 bg-white px-1 text-[10px] font-bold text-slate-400">من تاريخ</span>
                            <input type="date" className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-3.5 focus:outline-none focus:border-cyan-500 transition-all font-bold" value={dateFrom} onChange={handleDateFromChange} />
                        </div>
                        <div className="relative w-full md:w-36">
                            <span className="absolute -top-2.5 right-3 bg-white px-1 text-[10px] font-bold text-slate-400">إلى تاريخ</span>
                            <input type="date" className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-3.5 focus:outline-none focus:border-cyan-500 transition-all font-bold" value={dateTo} onChange={handleDateToChange} />
                        </div>
                        {(dateFrom || dateTo) && (
                            <button onClick={clearDateFilters} className="w-12 shrink-0 bg-rose-50 text-rose-500 rounded-xl border border-rose-100 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center shadow-sm" title="مسح التواريخ">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        )}
                    </div>
                </div>

            </div>

            {/* شريط الإحصائيات المالي */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-emerald-500 text-xs font-bold mb-1">إجمالي الإيرادات (المُحصلة)</p>
                        <h3 className="text-2xl font-black text-slate-800">{stats.revenue.toLocaleString()} <span className="text-xs font-bold text-slate-400">ج.م</span></h3>
                    </div>
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center text-xl"><i className="fa-solid fa-arrow-trend-up"></i></div>
                </div>
                
                <div className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-rose-500 text-xs font-bold mb-1">إجمالي المصروفات التشغيلية</p>
                        <h3 className="text-2xl font-black text-slate-800">{stats.expenses.toLocaleString()} <span className="text-xs font-bold text-slate-400">ج.م</span></h3>
                    </div>
                    <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center text-xl"><i className="fa-solid fa-arrow-trend-down"></i></div>
                </div>

                <div className={`p-5 rounded-2xl shadow-lg relative overflow-hidden flex items-center justify-between border sm:col-span-2 lg:col-span-1 ${stats.profit >= 0 ? 'bg-gradient-to-br from-[#0B1120] to-slate-800 border-slate-700 text-white' : 'bg-gradient-to-br from-rose-800 to-rose-900 border-rose-700 text-white'}`}>
                    <i className="fa-solid fa-wallet absolute -left-4 -bottom-4 text-7xl opacity-10"></i>
                    <div className="relative z-10">
                        <p className="text-slate-400 text-xs font-bold mb-1">صافي الربح الفعلي</p>
                        <h3 className={`text-3xl font-black ${stats.profit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>{stats.profit.toLocaleString()} <span className="text-xs font-bold opacity-70">ج.م</span></h3>
                    </div>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl relative z-10 ${stats.profit >= 0 ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/10 text-rose-300'}`}><i className="fa-solid fa-sack-dollar"></i></div>
                </div>
            </div>

            {/* التبويبات */}
            <div className="flex gap-2 border-b border-slate-200 overflow-x-auto hide-scrollbar">
                <button onClick={() => setActiveTab('invoices')} className={`px-6 py-3.5 font-black text-sm transition-all border-b-2 whitespace-nowrap ${activeTab === 'invoices' ? 'border-cyan-500 text-cyan-600 bg-cyan-50/50 rounded-t-xl' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-t-xl'}`}>
                    <i className="fa-solid fa-file-invoice mr-1.5"></i> فواتير أوامر الشغل
                </button>
                <button onClick={() => setActiveTab('expenses')} className={`px-6 py-3.5 font-black text-sm transition-all border-b-2 whitespace-nowrap ${activeTab === 'expenses' ? 'border-rose-500 text-rose-600 bg-rose-50/50 rounded-t-xl' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-t-xl'}`}>
                    <i className="fa-solid fa-money-bill-transfer mr-1.5"></i> سجل المصروفات
                </button>
            </div>

            {/* الجداول بناءً على التبويب النشط */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative">
                {isLoading && !showExpenseModal && !showPayModal && !showEditInvoiceModal && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                        <div className="w-12 h-12 border-4 border-cyan-100 border-t-cyan-500 rounded-full animate-spin"></div>
                    </div>
                )}

                <div className="overflow-x-auto hide-scrollbar">
                    <table className="w-full text-right text-sm min-w-[800px]">
                        
                        {activeTab === 'invoices' && (
                            <thead className="bg-slate-50/80 text-slate-500 font-bold border-b border-slate-100">
                                <tr>
                                    <th className="p-4 whitespace-nowrap">رقم الفاتورة</th>
                                    <th className="p-4 whitespace-nowrap">اسم العميل</th>
                                    <th className="p-4 whitespace-nowrap">الإجمالي المطلوب</th>
                                    <th className="p-4 whitespace-nowrap">تاريخ الإصدار</th>
                                    <th className="p-4 whitespace-nowrap text-center">الحالة</th>
                                    <th className="p-4 whitespace-nowrap text-center">إجراءات</th>
                                </tr>
                            </thead>
                        )}

                        {activeTab === 'expenses' && (
                            <thead className="bg-rose-50/50 text-slate-500 font-bold border-b border-rose-100">
                                <tr>
                                    <th className="p-4 whitespace-nowrap">نوع المصروف</th>
                                    <th className="p-4 whitespace-nowrap">البيان / الوصف</th>
                                    <th className="p-4 whitespace-nowrap text-center">تاريخ الصرف</th>
                                    <th className="p-4 whitespace-nowrap">المبلغ المنصرف</th>
                                    <th className="p-4 whitespace-nowrap text-center">إجراءات</th>
                                </tr>
                            </thead>
                        )}

                        <tbody className="divide-y divide-slate-50">
                            
                            {activeTab === 'invoices' && (listData?.length > 0 ? listData.map((inv) => {
                                const stUI = getInvoiceStatusUI(inv.status);
                                return (
                                    <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="p-4 font-black text-slate-700 tracking-wider font-mono bg-slate-50/50" dir="ltr">{inv.display_invoice_number}</td>
                                        <td className="p-4 font-bold text-slate-800">{inv.customer_name}</td>
                                        <td className="p-4 font-black text-cyan-600 text-base">{Number(inv.final_amount || inv.total_amount).toLocaleString()} <span className="text-[10px] text-slate-400">ج.م</span></td>
                                        <td className="p-4 text-xs font-bold text-slate-400" dir="ltr">{safeFormatDate(inv.display_date)}</td>
                                        <td className="p-4 text-center"><span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black shadow-sm ${stUI.color}`}>{stUI.text}</span></td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-1.5 opacity-100 md:opacity-50 group-hover:opacity-100 transition-opacity">
                                                {inv.status === 'غير مدفوعة' ? (
                                                    <button onClick={() => openPayModal(inv)} className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center shadow-sm" title="تحصيل الفاتورة">
                                                        <i className="fa-solid fa-hand-holding-dollar text-xs"></i>
                                                    </button>
                                                ) : (
                                                    <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-emerald-400" title="تم التحصيل">
                                                        <i className="fa-solid fa-check"></i>
                                                    </div>
                                                )}
                                                
                                                <button onClick={() => openEditInvoice(inv)} className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white transition-all flex items-center justify-center shadow-sm" title="تعديل الفاتورة وقطع الغيار">
                                                    <i className="fa-solid fa-pen text-xs"></i>
                                                </button>

                                                <button onClick={() => handlePrintInvoice(inv.id)} className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:bg-cyan-500 hover:text-white hover:border-cyan-500 transition-all flex items-center justify-center shadow-sm" title="طباعة الفاتورة">
                                                    <i className="fa-solid fa-print text-xs"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : <tr><td colSpan="6" className="p-12 text-center text-slate-400 font-bold"><div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-file-invoice text-2xl"></i></div>لا توجد فواتير مطابقة.</td></tr>)}

                            {activeTab === 'expenses' && (listData?.length > 0 ? listData.map((exp) => (
                                <tr key={exp.id} className="hover:bg-rose-50/20 transition-colors group">
                                    <td className="p-4 font-black text-slate-700">
                                        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs"><i className="fa-solid fa-tag text-slate-400 mr-1 text-[10px]"></i> {getExpenseTypeName(exp.expense_type)}</span>
                                    </td>
                                    <td className="p-4 font-semibold text-slate-600 max-w-[200px] truncate" title={exp.description}>{exp.description || '-'}</td>
                                    <td className="p-4 text-xs font-bold text-slate-400 text-center" dir="ltr">{safeFormatDate(exp.date || exp.expense_date)}</td>
                                    <td className="p-4 font-black text-rose-600 text-base">{Number(exp.amount).toLocaleString()} <span className="text-[10px] text-slate-400">ج.م</span></td>
                                    <td className="p-4 text-center">
                                        <button onClick={() => openEditExpense(exp)} className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all flex items-center justify-center mx-auto shadow-sm opacity-100 md:opacity-50 group-hover:opacity-100" title="تعديل المصروف">
                                            <i className="fa-solid fa-pen text-xs"></i>
                                        </button>
                                    </td>
                                </tr>
                            )) : <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-bold"><div className="w-16 h-16 bg-rose-50 text-rose-200 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-receipt text-2xl"></i></div>لا توجد مصروفات مسجلة.</td></tr>)}

                        </tbody>
                    </table>
                </div>

                {/* نظام التقليب (Pagination) */}
                {pagination.total > 0 && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <span className="text-[11px] font-bold text-slate-500">صفحة {pagination.current_page} من {pagination.last_page} <span className="mr-2 px-2 py-0.5 bg-white rounded-md border border-slate-200">إجمالي: {pagination.total}</span></span>
                        <div className="flex gap-2">
                            <button onClick={() => fetchData(pagination.current_page + 1, searchText, activeTab, dateFrom, dateTo)} disabled={pagination.current_page === pagination.last_page || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-right text-xs"></i></button>
                            <button onClick={() => fetchData(pagination.current_page - 1, searchText, activeTab, dateFrom, dateTo)} disabled={pagination.current_page === 1 || isLoading} className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200 disabled:opacity-50 transition-all shadow-sm"><i className="fa-solid fa-chevron-left text-xs"></i></button>
                        </div>
                    </div>
                )}
            </div>

            {/* ========================================== */}
            {/* إعلان النسخة المدفوعة */}
            {/* ========================================== */}
            <div className="mt-8 bg-[#0B1120] rounded-3xl p-6 md:p-8 border border-blue-500/30 shadow-[0_10px_40px_rgba(59,130,246,0.15)] relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 group hover:border-blue-500/60 transition-all">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none group-hover:bg-blue-500/20 transition-all duration-500"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4 pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-500"></div>
                <div className="relative z-10 flex items-center gap-5">
                    <div className="hidden sm:flex w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 items-center justify-center text-white text-3xl shadow-lg shadow-blue-500/25 shrink-0"><i className="fa-solid fa-chart-line"></i></div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-white uppercase tracking-wider">Pro Version</span>
                            <h3 className="text-xl md:text-2xl font-black text-white">تقارير مالية مفصلة وإرسال فواتير WhatsApp!</h3>
                        </div>
                        <p className="text-slate-400 text-xs md:text-sm font-bold mt-2 max-w-xl leading-relaxed">في النسخة المدفوعة، يمكنك استخراج تقارير أرباح شهرية وسنوية، طباعة فواتير بضريبة القيمة المضافة، وإرسال الفاتورة للعميل مباشرة على الواتساب بضغطة زر واحدة.</p>
                    </div>
                </div>
                <div className="relative z-10 w-full md:w-auto shrink-0 flex flex-col sm:flex-row gap-3">
                    <a href="https://wa.me/201211934816" target="_blank" className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white px-6 py-3 rounded-xl font-bold transition-transform hover:scale-105 shadow-lg shadow-[#25D366]/20">
                        <i className="fa-brands fa-whatsapp text-lg"></i><span dir="ltr">01211934816</span>
                    </a>
                </div>
            </div>

            {/* ========================================== */}
            {/* 1. نافذة المصروفات */}
            {/* ========================================== */}
            {showExpenseModal && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowExpenseModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm z-10 overflow-hidden animate-view border border-slate-100 flex flex-col max-h-[90vh]">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-rose-50/50 shrink-0">
                            <h3 className="text-lg font-black text-rose-700 flex items-center gap-2"><i className="fa-solid fa-money-bill-wave"></i> {expenseModalMode === 'add' ? 'تسجيل مصروف' : 'تعديل المصروف'}</h3>
                            <button onClick={() => setShowExpenseModal(false)} className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        <div className="p-6 overflow-y-auto">
                            <form id="expenseForm" onSubmit={handleExpenseSubmit} className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">نوع المصروف (البند)</label>
                                    <select required className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold bg-slate-50 focus:bg-white focus:outline-none focus:border-rose-500" value={expenseForm.expense_type} onChange={(e) => setExpenseForm({...expenseForm, expense_type: e.target.value})}>
                                        <option value="rent">إيجار</option>
                                        <option value="salaries">رواتب وأجور</option>
                                        <option value="utilities">مرافق (كهرباء، ماء، إنترنت)</option>
                                        <option value="equipment">معدات وأدوات</option>
                                        <option value="transportation">انتقالات وشحن</option>
                                        <option value="other">أخرى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">المبلغ المُنصرف</label>
                                    <div className="relative">
                                        <input type="number" min="1" step="0.01" required className="w-full border border-rose-200 rounded-xl px-4 py-4 text-xl text-center font-black text-rose-700 bg-rose-50 focus:outline-none focus:border-rose-500" value={expenseForm.amount} onChange={(e) => setExpenseForm({...expenseForm, amount: e.target.value})} />
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-rose-400 text-xs font-bold bg-white px-2 py-1 rounded border border-rose-100">ج.م</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">الوصف التفصيلي</label>
                                    <textarea rows="2" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold bg-slate-50 focus:bg-white focus:outline-none focus:border-rose-500 resize-none" value={expenseForm.description} onChange={(e) => setExpenseForm({...expenseForm, description: e.target.value})}></textarea>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">تاريخ الصرف</label>
                                    <input type="date" required className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold bg-slate-50 focus:bg-white focus:outline-none focus:border-rose-500" value={expenseForm.expense_date} onChange={(e) => setExpenseForm({...expenseForm, expense_date: e.target.value})} />
                                </div>
                            </form>
                        </div>
                        <div className="p-5 border-t border-slate-100 bg-slate-50 shrink-0">
                            <button type="submit" form="expenseForm" disabled={isUpdating} className="w-full bg-gradient-to-l from-rose-500 to-rose-600 text-white py-3.5 rounded-xl font-black transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 text-base">
                                {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>} حفظ البيانات
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* 2. نافذة تحصيل الفاتورة */}
            {/* ========================================== */}
            {showPayModal && selectedInvoice && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowPayModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm z-10 overflow-hidden animate-view border border-slate-100">
                        <div className="p-5 border-b border-slate-100 bg-emerald-50/50 text-center relative">
                            <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-emerald-100 flex items-center justify-center text-emerald-500 mx-auto mb-3"><i className="fa-solid fa-hand-holding-dollar text-xl"></i></div>
                            <h3 className="text-lg font-black text-emerald-800">تحصيل قيمة الفاتورة</h3>
                            <button onClick={() => setShowPayModal(false)} className="absolute left-4 top-4 w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        <form onSubmit={handlePaySubmit} className="p-6 space-y-6">
                            <div className="text-center bg-slate-50 p-5 rounded-2xl border border-slate-100">
                                <h2 className="text-3xl font-black text-cyan-600 mt-2">{Number(selectedInvoice.final_amount || selectedInvoice.total_amount).toLocaleString()} <span className="text-sm font-bold">ج.م</span></h2>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-2 text-center">اختر طريقة التحصيل والدفع</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {['كاش', 'فيزا', 'محفظة إلكترونية', 'تحويل بنكي'].map(method => (
                                        <div key={method} onClick={() => setPaymentMethod(method)} className={`cursor-pointer border-2 rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition-all ${paymentMethod === method ? 'border-emerald-500 bg-emerald-50 text-emerald-700 scale-[1.02]' : 'border-slate-100 text-slate-400 hover:bg-slate-50 hover:border-slate-200'}`}>
                                            <span className="text-xs font-black">{method}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <button type="submit" disabled={isUpdating} className="w-full bg-gradient-to-l from-emerald-500 to-emerald-600 text-white py-3.5 rounded-xl font-black flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 text-base">
                                {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check-double"></i>} تأكيد تسجيل التحصيل
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* 3. نافذة التعديل الاحترافي للفاتورة */}
            {/* ========================================== */}
            {showEditInvoiceModal && editInvoiceData && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowEditInvoiceModal(false)}></div>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl z-10 overflow-hidden animate-view border border-slate-100 flex flex-col h-[90vh]">
                        
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50/50 shrink-0">
                            <div>
                                <h3 className="text-lg font-black text-amber-700 flex items-center gap-2">
                                    <i className="fa-solid fa-file-pen"></i> تعديل الفاتورة المتقدم
                                </h3>
                                <p className="text-xs text-amber-600 font-bold mt-1">تعديل قطع الغيار والخدمات للفاتورة رقم: <span className="font-mono bg-white px-2 py-0.5 rounded border border-amber-200 ml-1">{editInvoiceData.display_invoice_number}</span></p>
                            </div>
                            <button onClick={() => setShowEditInvoiceModal(false)} className="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                            {editInvoiceData.status === 'مدفوعة' && (
                                <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
                                    <i className="fa-solid fa-triangle-exclamation text-rose-500 text-xl mt-0.5"></i>
                                    <div>
                                        <h4 className="font-black text-rose-700 text-sm">تنبيه هام جداً!</h4>
                                        <p className="text-xs text-rose-600 font-bold mt-1">هذه الفاتورة مسجلة على أنها "مدفوعة" وتم تحصيل قيمتها. أي تعديل سيؤدي إلى تغيير إجمالي الفاتورة، مما قد يتطلب تسوية يدوية مع العميل أو في الخزنة.</p>
                                    </div>
                                </div>
                            )}

                            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
                                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                                    <h4 className="font-black text-slate-700 text-sm">تفاصيل الحساب (قطع غيار / خدمات)</h4>
                                    <button onClick={addInvoiceItemRow} className="bg-cyan-50 text-cyan-600 hover:bg-cyan-500 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border border-cyan-100 flex items-center gap-1.5">
                                        <i className="fa-solid fa-plus"></i> إضافة بند
                                    </button>
                                </div>
                                
                                <div className="overflow-x-auto">
                                    <table className="w-full text-right text-sm min-w-[700px]">
                                        <thead className="bg-white border-b border-slate-100 text-slate-500 font-bold text-xs">
                                            <tr>
                                                <th className="p-3 w-32">نوع البند</th>
                                                <th className="p-3">البيان (القطعة / الخدمة)</th>
                                                <th className="p-3 w-24 text-center">الكمية</th>
                                                <th className="p-3 w-32 text-center">سعر الوحدة</th>
                                                <th className="p-3 w-32 text-center">الإجمالي</th>
                                                <th className="p-3 w-16 text-center">حذف</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {invoiceItems.length === 0 ? (
                                                <tr><td colSpan="6" className="p-8 text-center text-slate-400 text-xs font-bold">لا توجد بنود مسجلة. اضغط على إضافة بند.</td></tr>
                                            ) : invoiceItems.map((item, index) => (
                                                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-3">
                                                        <select className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-bold focus:border-cyan-500 outline-none" value={item.item_type} onChange={(e) => handleInvoiceItemChange(index, 'item_type', e.target.value)}>
                                                            <option value="part">قطعة غيار</option>
                                                            <option value="service">خدمة صيانة</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-3">
                                                        <select className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-bold focus:border-cyan-500 outline-none" value={item.item_id} onChange={(e) => handleInvoiceItemChange(index, 'item_id', e.target.value)}>
                                                            <option value="">-- اختر البند --</option>
                                                            {item.item_type === 'part' ? (
                                                                availableParts.map(p => <option key={p.id} value={p.id}>{p.part_name} (المتاح: {p.quantity})</option>)
                                                            ) : (
                                                                availableServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                                                            )}
                                                        </select>
                                                    </td>
                                                    <td className="p-3">
                                                        <input type="number" min="1" className="w-full bg-white border border-slate-200 rounded-lg p-2 text-center text-xs font-bold focus:border-cyan-500 outline-none" value={item.quantity} onChange={(e) => handleInvoiceItemChange(index, 'quantity', e.target.value)} />
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="relative">
                                                            <input type="number" min="0" className="w-full bg-white border border-slate-200 rounded-lg p-2 text-center text-xs font-bold focus:border-cyan-500 outline-none" value={item.price} onChange={(e) => handleInvoiceItemChange(index, 'price', e.target.value)} />
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-center font-black text-cyan-600 text-sm bg-slate-50/50">
                                                        {(Number(item.quantity) * Number(item.price)).toLocaleString()}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <button onClick={() => removeInvoiceItemRow(index)} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors flex items-center justify-center mx-auto"><i className="fa-solid fa-trash-can text-xs"></i></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm max-w-sm mr-auto">
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between items-center text-slate-500 font-bold">
                                        <span>إجمالي البنود:</span>
                                        <span>{getInvoiceEditTotals().subTotal.toLocaleString()} ج.م</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-500 font-bold text-xs mt-1">قيمة الخصم (إن وجد):</span>
                                        <input type="number" min="0" className="w-24 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg p-1.5 text-center text-sm font-black focus:border-rose-500 outline-none" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} />
                                    </div>
                                    <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
                                        <span className="font-black text-slate-800 text-lg">الصافي المطلوب:</span>
                                        <span className="font-black text-cyan-600 text-xl">{getInvoiceEditTotals().finalTotal.toLocaleString()} ج.م</span>
                                    </div>
                                </div>
                            </div>

                        </div>

                        <div className="p-5 border-t border-slate-100 bg-white shrink-0 flex justify-end gap-3">
                            <button onClick={() => setShowEditInvoiceModal(false)} className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors">إلغاء والتراجع</button>
                            <button onClick={handleSaveInvoiceEdit} disabled={isUpdating} className="bg-gradient-to-l from-amber-500 to-amber-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-amber-500/30 hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-70">
                                {isUpdating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-save"></i>} حفظ التعديلات وتحديث المخزن
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};