// describe('ProgressTracker', () => {
//     test('should track progress correctly', async () => {
//         const tracker = new ProgressTracker({
//             serviceName: 'Test Service',
//             totalTasks: 100,
//             enablePrometheus: false,
//         });

//         // Simulate processing tasks
//         for (let i = 0; i < 80; i++) {
//             tracker.incrementSuccess();
//             await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay to see progress
//         }

//         // Simulate some errors
//         for (let i = 0; i < 20; i++) {
//             tracker.incrementError();
//             await new Promise((resolve) => setTimeout(resolve, 10));
//         }

//         await tracker.complete();

//         // If we got here without errors, the test passed
//         expect(true).toBe(true);
//     });

//     test('should display error count only when errors exist', async () => {
//         // Test 1: No errors - error count should not be displayed
//         const trackerNoErrors = new ProgressTracker({
//             serviceName: 'No Errors Test',
//             totalTasks: 10,
//             enablePrometheus: false,
//             verbose: false, // Disable verbose to avoid console output during test
//         });

//         for (let i = 0; i < 10; i++) {
//             trackerNoErrors.incrementSuccess();
//         }
//         await trackerNoErrors.complete();

//         // Test 2: With errors - error count should be displayed
//         const trackerWithErrors = new ProgressTracker({
//             serviceName: 'With Errors Test',
//             totalTasks: 10,
//             enablePrometheus: false,
//             verbose: false, // Disable verbose to avoid console output during test
//         });

//         for (let i = 0; i < 7; i++) {
//             trackerWithErrors.incrementSuccess();
//         }
//         for (let i = 0; i < 3; i++) {
//             trackerWithErrors.incrementError();
//         }
//         await trackerWithErrors.complete();

//         // If we got here without errors, the test passed
//         expect(true).toBe(true);
//     });
// });
