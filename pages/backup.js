// ============================================================================
// Module: Backup & Restore (مركز النسخ الاحتياطي - MentraFix Lite)
// ============================================================================

window.Module_Backup = function({ centerId, userId, showToast }) {
    const { useState, useRef, useEffect } = React;

    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("جاري المعالجة..."); // نص ديناميكي لطمأنة المستخدم
    const [lastBackup, setLastBackup] = useState(localStorage.getItem(`MentraFix_LastBackup_${centerId}`) || 'لم يتم عمل نسخة بعد');
    const fileInputRef = useRef(null);

    // دالة مساعدة لعمل إيقاف مؤقت صغير جداً للسماح للواجهة بالتحديث (تمنع تجميد الشاشة)
    const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 50));

    // ----------------------------------------------------------------------
    // 1. دالة تصدير البيانات (Export / Backup) - محسنة للبيانات الضخمة
    // ----------------------------------------------------------------------
    const handleExport = async () => {
        setIsLoading(true);
        setLoadingText("جاري تجميع بيانات المركز...");
        await yieldToMain();

        try {
            const db = window.db;
            if (!db) throw new Error("قاعدة البيانات غير متصلة");

            const backupData = {};
            for (const table of db.tables) {
                setLoadingText(`جاري تجهيز جدول: ${table.name}...`);
                await yieldToMain();
                backupData[table.name] = await table.toArray();
            }

            setLoadingText("جاري إنشاء ملف النسخة الاحتياطية...");
            await yieldToMain();

            const backupObject = {
                app: "MentraFix",
                centerId: centerId,
                timestamp: new Date().toISOString(),
                data: backupData
            };

            // استخدام Blob بدلاً من Data URI لمنع انهيار المتصفح مع الملفات الكبيرة
            const jsonString = JSON.stringify(backupObject);
            const blob = new Blob([jsonString], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.href = url;
            
            const dateStr = new Date().toISOString().split('T')[0];
            downloadAnchorNode.download = `MentraFix_Backup_${dateStr}.json`;
            
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            document.body.removeChild(downloadAnchorNode);
            URL.revokeObjectURL(url); // تنظيف الذاكرة

            const now = new Date().toLocaleString('ar-EG');
            localStorage.setItem(`MentraFix_LastBackup_${centerId}`, now);
            setLastBackup(now);

            showToast("تم تحميل النسخة الاحتياطية بنجاح!", "success");
        } catch (error) {
            console.error("خطأ في التصدير:", error);
            showToast("حدث خطأ أثناء أخذ النسخة الاحتياطية", "error");
        } finally {
            setIsLoading(false);
        }
    };

    // ----------------------------------------------------------------------
    // 2. دالة استيراد البيانات (Import / Restore) - تدعم Chunking للبيانات الضخمة
    // ----------------------------------------------------------------------
    const triggerImport = () => {
        fileInputRef.current.click();
    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsLoading(true);
        setLoadingText("جاري قراءة الملف... يرجى الانتظار");

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setLoadingText("جاري تحليل البيانات...");
                await yieldToMain();
                
                const importedData = JSON.parse(e.target.result);

                // التأكد من أن الملف يخص نظام الصيانة
                if (importedData.app !== "MentraFix" || !importedData.data) {
                    throw new Error("ملف النسخة الاحتياطية غير صالح أو لا يتبع النظام");
                }

                if (confirm("تحذير: سيتم مسح البيانات الحالية واستبدالها ببيانات النسخة الاحتياطية. هل أنت متأكد؟")) {
                    const db = window.db;
                    
                    setLoadingText("جاري تفريغ الجداول القديمة...");
                    await yieldToMain();

                    // عملية الإدخال على دفعات (Chunks) لمنع توقف المتصفح
                    await db.transaction('rw', db.tables, async () => {
                        for (const table of db.tables) {
                            if (importedData.data[table.name]) {
                                await table.clear();
                                const records = importedData.data[table.name];
                                const chunkSize = 1000; // إدخال 1000 سجل في كل دفعة
                                
                                for (let i = 0; i < records.length; i += chunkSize) {
                                    const chunk = records.slice(i, i + chunkSize);
                                    await table.bulkAdd(chunk);
                                }
                            }
                        }
                    });

                    showToast("تم استرجاع البيانات بنجاح! سيتم إعادة تشغيل النظام.", "success");
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    setIsLoading(false);
                }
            } catch (error) {
                console.error("خطأ في الاستيراد:", error);
                showToast(error.message || "حدث خطأ أثناء قراءة الملف، قد يكون تالفاً أو كبيراً جداً", "error");
                setIsLoading(false);
            } finally {
                event.target.value = ""; 
            }
        };
        
        reader.readAsText(file);
    };

    // ----------------------------------------------------------------------
    // 3. دالة تفريغ النظام (Factory Reset)
    // ----------------------------------------------------------------------
    const handleFactoryReset = async () => {
        if (!confirm("🚨 تحذير خطير جداً 🚨\nهل أنت متأكد من رغبتك في مسح كافة بيانات المركز (العملاء، الأجهزة، المخزن، الفواتير)؟ لا يمكن التراجع عن هذه الخطوة!")) return;
        
        // أسلوب تأكيد أفضل للموبايل
        if (!confirm("تأكيد نهائي: هل أنت متأكد تماماً من مسح كل شيء والبدء من الصفر؟")) return;

        setIsLoading(true);
        setLoadingText("جاري تدمير البيانات... لا تغلق الصفحة");
        try {
            const db = window.db;
            await db.transaction('rw', db.tables, async () => {
                for (const table of db.tables) {
                    await table.clear();
                }
            });
            showToast("تم مسح كافة البيانات. سيتم توجيهك لتسجيل الخروج.", "success");
            setTimeout(() => {
                localStorage.removeItem('MentraFix_Session');
                window.location.replace('subscriptions.html');
            }, 2000);
        } catch (error) {
            console.error("خطأ في مسح البيانات:", error);
            showToast("حدث خطأ أثناء مسح البيانات", "error");
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 fade-up pb-28 md:pb-8 relative max-w-5xl mx-auto">
            
            {/* مؤشر التحميل (Loader) */}
            {isLoading && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
                    <div className="bg-white p-6 md:p-8 rounded-3xl shadow-2xl flex flex-col items-center text-center max-w-sm w-full animate-view border border-slate-100">
                        <i className="fas fa-circle-notch fa-spin text-5xl text-[#06B6D4] mb-5"></i>
                        <h3 className="font-black text-slate-800 text-lg mb-2">يرجى الانتظار</h3>
                        <p className="font-bold text-slate-500 text-sm">{loadingText}</p>
                        <p className="text-[10px] text-rose-500 mt-4 font-bold bg-rose-50 px-3 py-1 rounded-full border border-rose-100">لا تقم بإغلاق المتصفح أو التطبيق</p>
                    </div>
                </div>
            )}

            {/* الهيدر */}
            <div className="bg-gradient-to-l from-[#06B6D4] to-[#3B82F6] rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
                <i className="fas fa-database absolute -left-4 -bottom-10 text-9xl opacity-10"></i>
                <h2 className="text-xl md:text-2xl font-black mb-2 relative z-10">مركز النسخ الاحتياطي</h2>
                <p className="text-white/90 text-xs md:text-sm font-bold relative z-10 max-w-xl leading-relaxed">
                    هذا النظام يعمل بدون إنترنت على جهازك فقط. لتجنب ضياع بيانات عملائك أوامر الشغل والفواتير، نرجو تحميل نسخة احتياطية يومياً.
                </p>
                <div className="mt-5 inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold relative z-10 shadow-sm border border-white/10">
                    <i className="fas fa-clock"></i>
                    آخر نسخة: <span dir="ltr" className="ml-1 text-white font-black">{lastBackup}</span>
                </div>
            </div>

            {/* الكروت الأساسية */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col items-center text-center hover:border-cyan-200 transition-colors">
                    <div className="w-16 h-16 rounded-2xl bg-cyan-50 text-[#06B6D4] flex items-center justify-center text-2xl mb-4 shadow-sm border border-cyan-100">
                        <i className="fas fa-download"></i>
                    </div>
                    <h3 className="text-lg font-black text-slate-800 mb-2">أخذ نسخة احتياطية</h3>
                    <p className="text-slate-500 text-xs md:text-sm font-bold mb-6">
                        يقوم بتحميل ملف يحتوي على جميع بيانات العملاء، الأجهزة، المخزن، والمالية لحفظها على جهازك أو الفلاشة.
                    </p>
                    <button 
                        onClick={handleExport}
                        className="w-full mt-auto bg-slate-800 text-white font-black py-4 rounded-2xl hover:bg-slate-900 transition-colors flex justify-center items-center gap-2 active:scale-95 shadow-lg"
                    >
                        <i className="fas fa-save"></i> تحميل النسخة الآن
                    </button>
                </div>

                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col items-center text-center hover:border-blue-200 transition-colors">
                    <div className="w-16 h-16 rounded-2xl bg-blue-50 text-[#3B82F6] flex items-center justify-center text-2xl mb-4 shadow-sm border border-blue-100">
                        <i className="fas fa-upload"></i>
                    </div>
                    <h3 className="text-lg font-black text-slate-800 mb-2">استرجاع نسخة سابقة</h3>
                    <p className="text-slate-500 text-xs md:text-sm font-bold mb-6">
                        قم برفع ملف النسخة الاحتياطية الذي قمت بتحميله مسبقاً لاستعادة البيانات. (سيتم استبدال بياناتك الحالية).
                    </p>
                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} className="hidden" />
                    <button 
                        onClick={triggerImport}
                        className="w-full mt-auto border-2 border-slate-200 text-slate-700 font-black py-4 rounded-2xl hover:border-[#3B82F6] hover:text-[#3B82F6] hover:bg-blue-50 transition-all flex justify-center items-center gap-2 active:scale-95"
                    >
                        <i className="fas fa-folder-open"></i> اختيار ملف النسخة
                    </button>
                </div>
            </div>
			
            {/* منطقة الخطر */}
			<div className="bg-rose-50 rounded-3xl p-5 md:p-6 border border-rose-200 flex flex-col sm:flex-row items-center gap-4 justify-between text-center sm:text-right mt-2">
                <div>
                    <h3 className="text-rose-700 font-black text-base md:text-lg mb-1 flex items-center justify-center sm:justify-start gap-2">
                        <i className="fas fa-exclamation-triangle"></i> منطقة الخطر (إعادة ضبط المصنع)
                    </h3>
                    <p className="text-rose-600/80 text-xs md:text-sm font-bold">
                        هذا الإجراء سيقوم بمسح كافة البيانات من النظام تماماً ولا يمكن التراجع عنه.
                    </p>
                </div>
                <button 
                    onClick={handleFactoryReset}
                    className="w-full sm:w-auto px-6 py-3.5 bg-rose-600 text-white text-sm font-black rounded-xl hover:bg-rose-700 transition-colors flex-shrink-0 shadow-md active:scale-95"
                >
                    مسح جميع البيانات
                </button>
            </div>

            {/* ================= إعلان النسخة المدفوعة ================= */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-[#0B1120] rounded-3xl p-6 sm:p-8 shadow-xl border border-cyan-500/20 group mt-6">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#06B6D4]/10 rounded-full blur-[60px] pointer-events-none group-hover:bg-[#06B6D4]/20 transition-all duration-700"></div>
                <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-6">
                    <div className="flex-1 text-center lg:text-right text-white">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/10 rounded-full text-cyan-400 text-xs font-black mb-3 backdrop-blur-sm">
                            <i className="fas fa-cloud animate-pulse"></i> أمان سحابي تلقائي
                        </div>
                        <h3 className="text-xl sm:text-2xl font-black mb-2 tracking-tight">
                            تخشى ضياع هاتفك أو تلف جهازك؟ <span className="text-transparent bg-clip-text bg-gradient-to-l from-[#06B6D4] to-[#3B82F6]">النسخة السحابية</span> هي الحل!
                        </h3>
                        <p className="text-slate-400 font-bold text-xs sm:text-sm leading-relaxed max-w-2xl mx-auto lg:mx-0">
                            لا حاجة لأخذ نسخ احتياطية يدوياً بعد الآن. في نسخة <span className="text-white">MentraFix PRO</span> تُحفظ بياناتك لحظياً على خوادم سحابية آمنة، ويمكنك متابعة مركزك من أي جهاز في العالم.
                        </p>
                    </div>
                    <a href="https://wa.me/201211934816" target="_blank" className="w-full lg:w-auto bg-gradient-to-l from-[#06B6D4] to-[#3B82F6] hover:opacity-90 text-white font-black px-6 py-4 rounded-xl shadow-[0_10px_20px_-10px_rgba(6,182,212,0.5)] transition-all flex items-center justify-center gap-3 whitespace-nowrap text-sm sm:text-base">
                        <i className="fab fa-whatsapp text-xl"></i><span>اسأل عن أسعار السحابي</span>
                    </a>
                </div>
            </div>

        </div>
    );
};