import { ProgressTracker } from './lib/progress';

async function testMetricsReset() {
    const port = 29090;
    
    // First run
    const tracker = new ProgressTracker({
        serviceName: 'Test Service',
        totalTasks: 10,
        enablePrometheus: true,
        prometheusPort: port,
        verbose: false,
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate some tasks
    for (let i = 0; i < 5; i++) {
        tracker.incrementSuccess();
    }
    for (let i = 0; i < 2; i++) {
        tracker.incrementError();
    }
    
    // Fetch metrics
    const response1 = await fetch(`http://localhost:${port}/metrics`);
    const metrics1 = await response1.text();
    console.log('=== After first iteration ===');
    console.log(metrics1.split('\n').filter(line => line.includes('scraper_') && !line.startsWith('#')).join('\n'));
    
    // Complete but keep alive
    await tracker.complete({ keepPrometheusAlive: true });
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Reset for second run
    tracker.reset(15);
    
    // Simulate more tasks
    for (let i = 0; i < 8; i++) {
        tracker.incrementSuccess();
    }
    for (let i = 0; i < 3; i++) {
        tracker.incrementError();
    }
    
    // Fetch metrics again
    const response2 = await fetch(`http://localhost:${port}/metrics`);
    const metrics2 = await response2.text();
    console.log('\n=== After second iteration (after reset) ===');
    console.log(metrics2.split('\n').filter(line => line.includes('scraper_') && !line.startsWith('#')).join('\n'));
    
    // Clean up
    await tracker.complete({ keepPrometheusAlive: false });
    await new Promise(resolve => setTimeout(resolve, 200));
}

testMetricsReset().catch(console.error);
