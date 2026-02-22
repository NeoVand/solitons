import puppeteer from 'puppeteer';

(async () => {
    // Launch browser with WebGPU enabled
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan'
        ]
    });

    const page = await browser.newPage();

    // Catch console logs to see if WebGPU init failed
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));

    console.log("Navigating to http://localhost:5173...");
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    console.log("Waiting 2 seconds for WebGPU init to complete...");
    await new Promise(r => setTimeout(r, 2000));

    await browser.close();
    console.log("Test finished.");
})();
