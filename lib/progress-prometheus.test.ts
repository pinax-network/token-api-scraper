import { ProgressTracker } from './progress';

// Test ProgressTracker with Prometheus enabled
async function testProgressTrackerWithPrometheus() {
    console.log('Testing ProgressTracker with Prometheus...\n');

    const tracker = new ProgressTracker({
        serviceName: 'Test Prometheus Service',
        totalTasks: 50,
        enablePrometheus: true,
        prometheusPort: 19090 // Use a different port to avoid conflicts
    });

    // Simulate processing tasks
    for (let i = 0; i < 40; i++) {
        tracker.incrementSuccess();
        await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Simulate some errors
    for (let i = 0; i < 10; i++) {
        tracker.incrementError();
        await new Promise(resolve => setTimeout(resolve, 20));
    }

    tracker.complete();
    
    console.log('\n✅ ProgressTracker with Prometheus test completed!');
    console.log('✅ Metrics should be available at http://localhost:19090/metrics');
    
    // Give a moment to check the metrics endpoint
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    tracker.stop();
    console.log('\n✅ Prometheus server stopped');
}

// Run the test if this file is executed directly
if (import.meta.main) {
    testProgressTrackerWithPrometheus();
}
