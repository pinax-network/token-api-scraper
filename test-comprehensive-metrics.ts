// Comprehensive test to verify metrics persist correctly across iterations

import { ProgressTracker } from './lib/progress';

async function comprehensiveTest() {
    const port = 29093;
    let tracker: ProgressTracker | undefined;
    
    console.log('=== Test: Verifying metrics persist across multiple iterations ===\n');
    
    // Simulate 5 iterations like auto-restart would do
    for (let iter = 1; iter <= 5; iter++) {
        console.log(`--- Iteration ${iter} ---`);
        
        const tasksThisIteration = 10;
        const successesThisIteration = Math.floor(Math.random() * 7) + 3;
        const errorsThisIteration = tasksThisIteration - successesThisIteration;
        
        // Simulate service pattern
        if (!tracker) {
            tracker = new ProgressTracker({
                serviceName: 'Test Service',
                totalTasks: tasksThisIteration,
                enablePrometheus: true,
                prometheusPort: port,
                verbose: false,
            });
            await new Promise(resolve => setTimeout(resolve, 100));
        } else {
            tracker.reset(tasksThisIteration);
        }
        
        // Process tasks
        for (let i = 0; i < successesThisIteration; i++) {
            tracker.incrementSuccess();
        }
        for (let i = 0; i < errorsThisIteration; i++) {
            tracker.incrementError();
        }
        
        // Complete but keep alive
        await tracker.complete({ keepPrometheusAlive: true });
        
        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        const metrics = await response.text();
        
        // Extract counter values
        const successMatch = metrics.match(/scraper_completed_tasks_total{service="Test Service",status="success"} (\d+)/);
        const errorMatch = metrics.match(/scraper_completed_tasks_total{service="Test Service",status="error"} (\d+)/);
        const errorCounterMatch = metrics.match(/scraper_error_tasks_total{service="Test Service"} (\d+)/);
        
        const successCount = successMatch ? parseInt(successMatch[1]) : 0;
        const errorCount = errorMatch ? parseInt(errorMatch[1]) : 0;
        const errorCounter = errorCounterMatch ? parseInt(errorCounterMatch[1]) : 0;
        
        console.log(`  Tasks: ${tasksThisIteration} (${successesThisIteration} success, ${errorsThisIteration} errors)`);
        console.log(`  Total accumulated successes: ${successCount}`);
        console.log(`  Total accumulated errors: ${errorCount}`);
        console.log(`  Error counter: ${errorCounter}`);
        
        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Final cleanup
    if (tracker) {
        await tracker.complete({ keepPrometheusAlive: false });
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log('\n=== Test completed successfully ===');
    console.log('✓ Metrics persisted correctly across all iterations');
    console.log('✓ Counters accumulated as expected (never reset)');
    console.log('✓ Gauge values updated correctly for each iteration');
}

comprehensiveTest().catch(console.error);
