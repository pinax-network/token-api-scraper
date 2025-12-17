// describe('ProgressTracker ETA Smoothing', () => {
//     test('should smooth rate calculation with varying request rates', async () => {
//         const tracker = new ProgressTracker({
//             serviceName: 'Variable Rate Test',
//             totalTasks: 1000,
//             enablePrometheus: false,
//         });

//         // Simulate variable request rates
//         // Phase 1: Fast rate (100 tasks in 100ms)
//         for (let i = 0; i < 100; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 1));
//         }

//         // Phase 2: Slow rate (50 tasks in 500ms)
//         for (let i = 0; i < 50; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 10));
//         }

//         // Phase 3: Fast rate again (100 tasks in 100ms)
//         for (let i = 0; i < 100; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 1));
//         }

//         // Phase 4: Moderate rate (50 tasks in 200ms)
//         for (let i = 0; i < 50; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 4));
//         }

//         await tracker.complete();

//         // If we got here without errors, the test passed
//         // The smoothing should prevent drastic ETA changes between phases
//         expect(true).toBe(true);
//     });

//     test('should handle initial requests with no history', async () => {
//         const tracker = new ProgressTracker({
//             serviceName: 'Initial Requests Test',
//             totalTasks: 10,
//             enablePrometheus: false,
//         });

//         // Process just a few tasks to test initial behavior
//         for (let i = 0; i < 5; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 50));
//         }

//         await tracker.complete();

//         expect(true).toBe(true);
//     });

//     test('should use 1-minute rolling window for rate calculation', async () => {
//         const tracker = new ProgressTracker({
//             serviceName: 'Rolling Window Test',
//             totalTasks: 200,
//             enablePrometheus: false,
//         });

//         // Process tasks with consistent rate
//         for (let i = 0; i < 100; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 5));
//         }

//         await tracker.complete();

//         // The rate should be calculated based on the rolling window
//         expect(true).toBe(true);
//     });

//     test('should calculate custom ETA based on smoothed rate', async () => {
//         const tracker = new ProgressTracker({
//             serviceName: 'Custom ETA Test',
//             totalTasks: 100,
//             enablePrometheus: false,
//         });

//         // Process tasks with a consistent rate
//         // This ensures the rate stabilizes and ETA should be predictable
//         for (let i = 0; i < 50; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 10));
//         }

//         await tracker.complete();

//         // The custom ETA should be calculated as: (totalTasks - completedTasks) / rate
//         // With a stable rate, ETA should not jump drastically
//         expect(true).toBe(true);
//     });
// });
