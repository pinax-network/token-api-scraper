// Test if module reloading causes metrics to reset

async function testWithModuleReload() {
    const port = 29091;
    
    // Import module first time
    const { ProgressTracker: PT1 } = await import('./lib/progress');
    
    const tracker1 = new PT1({
        serviceName: 'Test Service',
        totalTasks: 10,
        enablePrometheus: true,
        prometheusPort: port,
        verbose: false,
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    for (let i = 0; i < 5; i++) {
        tracker1.incrementSuccess();
    }
    
    const response1 = await fetch(`http://localhost:${port}/metrics`);
    const metrics1 = await response1.text();
    console.log('=== After first module import ===');
    console.log(metrics1.split('\n').filter(line => line.includes('scraper_completed_tasks_total')).join('\n'));
    
    // Stop and cleanup
    await tracker1.stop();
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Try to re-import (this won't actually reload in Node.js/Bun)
    const { ProgressTracker: PT2 } = await import('./lib/progress');
    
    const tracker2 = new PT2({
        serviceName: 'Test Service',
        totalTasks: 10,
        enablePrometheus: true,
        prometheusPort: port,
        verbose: false,
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    for (let i = 0; i < 3; i++) {
        tracker2.incrementSuccess();
    }
    
    const response2 = await fetch(`http://localhost:${port}/metrics`);
    const metrics2 = await response2.text();
    console.log('\n=== After second module import ===');
    console.log(metrics2.split('\n').filter(line => line.includes('scraper_completed_tasks_total')).join('\n'));
    
    await tracker2.stop();
    await new Promise(resolve => setTimeout(resolve, 200));
}

testWithModuleReload().catch(console.error);
