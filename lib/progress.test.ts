import { ProgressTracker } from './progress';

// Simple test to verify the ProgressTracker works correctly
async function testProgressTracker() {
    console.log('Testing ProgressTracker...\n');

    const tracker = new ProgressTracker({
        serviceName: 'Test Service',
        totalTasks: 100,
        enablePrometheus: false
    });

    // Simulate processing tasks
    for (let i = 0; i < 80; i++) {
        tracker.incrementSuccess();
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to see progress
    }

    // Simulate some errors
    for (let i = 0; i < 20; i++) {
        tracker.incrementError();
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    tracker.complete();
    
    console.log('\n✅ ProgressTracker test completed successfully!');
}

// Run the test if this file is executed directly
if (import.meta.main) {
    testProgressTracker();
}
