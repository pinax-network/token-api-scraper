// Simulate the exact pattern used in the services

import { ProgressTracker } from './lib/progress';

async function mockServiceRun(tracker?: ProgressTracker) {
    const totalTasks = Math.floor(Math.random() * 10) + 5;
    
    // Initialize or reset progress tracker (this is what services do)
    const shouldCreateTracker = !tracker;
    if (shouldCreateTracker) {
        tracker = new ProgressTracker({
            serviceName: 'Mock Service',
            totalTasks,
            enablePrometheus: true,
            prometheusPort: 29092,
            verbose: false,
        });
    } else {
        tracker.reset(totalTasks);
    }
    
    // Simulate processing
    const successes = Math.floor(totalTasks * 0.8);
    const errors = totalTasks - successes;
    
    for (let i = 0; i < successes; i++) {
        tracker.incrementSuccess();
    }
    for (let i = 0; i < errors; i++) {
        tracker.incrementError();
    }
    
    // Complete but keep alive (this is what services do)
    await tracker.complete({ keepPrometheusAlive: true });
    
    return tracker;
}

async function simulateAutoRestart() {
    let tracker: ProgressTracker | undefined;
    
    for (let iteration = 1; iteration <= 3; iteration++) {
        console.log(`\n=== Iteration ${iteration} ===`);
        tracker = await mockServiceRun(tracker);
        
        // Fetch and display metrics
        const response = await fetch('http://localhost:29092/metrics');
        const metrics = await response.text();
        const relevantMetrics = metrics.split('\n').filter(line => 
            line.includes('scraper_') && !line.startsWith('#') && line.includes('Mock Service')
        );
        console.log(relevantMetrics.join('\n'));
        
        // Small delay like auto-restart
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Final cleanup
    if (tracker) {
        await tracker.complete({ keepPrometheusAlive: false });
    }
    await new Promise(resolve => setTimeout(resolve, 200));
}

simulateAutoRestart().catch(console.error);
