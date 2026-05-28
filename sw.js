// ==========================================
// MentraClinics Lite - Service Worker (Offline First)
// ==========================================

const CACHE_NAME = 'Mentra-GymLite-v4.0';

// الملفات الأساسية التي يجب تحميلها فور تشغيل البرنامج لأول مرة
const CORE_ASSETS = [
    './',
    './index.html',
    './subscriptions.html',
    './dashboard.html',
    './Tutorial.html',
    './database.js',
    './manifest.json',
    './assets/logo.png',
	'./assets/step1.PNG',
	'./assets/step2.PNG',
	'./assets/step3.PNG',
	'./assets/step4.PNG',
	'./assets/step5.PNG',
	'./assets/step6.PNG',
	'./assets/step7.PNG',
	'./assets/start.PNG',


    
    // شاشات النظام المبرمجة ديناميكياً (يجب أن تكون في مجلد pages)
    './pages/main.js',
    './pages/customers.js',
    './pages/purchases_and_stock.js',
    './pages/requests.js',
    './pages/inventory.js',
    './pages/finances.js',
    './pages/settings.js',
    './pages/backup.js'
];

// الروابط الخارجية (CDNs) مثل React و Tailwind و FontAwesome   subscriptions
const CDN_URLS = [
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com'
];

// 1. حدث التثبيت (Install Event) - حفظ الملفات الأساسية
self.addEventListener('install', (event) => {
    self.skipWaiting(); // تفعيل النسخة الجديدة فوراً
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📦 [Service Worker] Caching Core Assets...');
            // نستخدم catch لتجنب توقف التثبيت إذا كان هناك ملف مفقود
            return Promise.allSettled(
                CORE_ASSETS.map(url => 
                    cache.add(url).catch(err => console.warn(`⚠️ لم يتم العثور على: ${url}`))
                )
            );
        })
    );
});

// 2. حدث التفعيل (Activate Event) - مسح الكاش القديم إن وُجد
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ [Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. حدث جلب البيانات (Fetch Event) - المنطق الذكي للعمل Offline
self.addEventListener('fetch', (event) => {
    const requestUrl = event.request.url;

    // أ) إذا كان الطلب من مكتبة خارجية (CDN)
    if (CDN_URLS.some(cdn => requestUrl.includes(cdn))) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse; // إرجاعها من الكاش إذا وجدت
                
                return fetch(event.request).then((networkResponse) => {
                    return caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                }).catch(() => {
                    console.warn('❌ [Service Worker] Network failed for CDN:', requestUrl);
                });
            })
        );
        return;
    }

    // ب) إذا كان الطلب لملفات النظام المحلية (HTML, JS, CSS, PNG)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // استراتيجية: Stale-While-Revalidate (عرض الكاش مع تحديثه في الخلفية إذا وجد إنترنت)
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                });
                return networkResponse;
            }).catch(() => {
                // إذا لم يوجد إنترنت، لا تفعل شيئاً (الكاش سيعمل)
            });

            return cachedResponse || fetchPromise;
        })
    );
});
