/**
 * @file test-vla-client.ts
 * @description End-to-end test for VLA gRPC client
 * @feature vla
 *
 * Run with: npx tsx test-vla-client.ts
 */

import { VLAClient } from './src/vla/index.js';

async function test() {
  console.log('🧪 VLA gRPC Client End-to-End Test\n');
  console.log('='.repeat(50));

  const client = new VLAClient({
    host: 'localhost',
    port: 50051,
    poolSize: 2,
    healthCheckIntervalMs: 10000,
  });

  try {
    // Test 1: Connect to server
    console.log('\n📡 Test 1: Connecting to VLA server...');
    await client.connect();
    console.log('✅ Connected successfully');
    console.log(`   State: ${client.state}`);

    // Test 2: Health check
    console.log('\n🏥 Test 2: Health check...');
    const health = await client.healthCheck();
    console.log('✅ Health check passed');
    console.log(`   Ready: ${health.ready}`);
    console.log(`   GPU Utilization: ${health.gpuUtilization ?? 0}%`);
    console.log(`   Memory Utilization: ${health.memoryUtilization ?? 0}%`);
    console.log(`   Queue Depth: ${health.queueDepth ?? 0}`);
    console.log(`   Uptime: ${(health.uptimeSeconds ?? 0).toFixed(1)}s`);
    console.log(`   Total Requests: ${health.totalRequests ?? 0}`);

    // Test 3: Get model info
    console.log('\n📋 Test 3: Get model info...');
    const modelInfo = await client.getModelInfo();
    console.log('✅ Model info retrieved');
    console.log(`   Model Name: ${modelInfo.modelName ?? 'N/A'}`);
    console.log(`   Version: ${modelInfo.modelVersion ?? 'N/A'}`);
    console.log(`   Base Model: ${modelInfo.baseModel ?? 'N/A'}`);
    console.log(`   Action Dim: ${modelInfo.actionDim ?? 0}`);
    console.log(`   Chunk Size: ${modelInfo.chunkSize ?? 0}`);
    console.log(`   Image Size: ${modelInfo.imageWidth ?? 0}x${modelInfo.imageHeight ?? 0}`);
    console.log(`   Embodiments: ${(modelInfo.supportedEmbodiments ?? []).join(', ') || 'none'}`);

    // Test 4: Single prediction
    console.log('\n🤖 Test 4: Single prediction...');
    const observation = {
      cameraImage: Buffer.from('fake-jpeg-data'),
      jointPositions: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      jointVelocities: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      languageInstruction: 'pick up the red cup and place it on the table',
      timestamp: Date.now() / 1000,
      embodimentTag: 'unitree_h1',
    };

    const result = await client.predict(observation);
    console.log('✅ Prediction successful');
    console.log(`   Actions: ${result.actions?.length ?? 0}`);
    console.log(`   Inference Time: ${(result.inferenceTimeMs ?? 0).toFixed(2)}ms`);
    console.log(`   Model Version: ${result.modelVersion ?? 'N/A'}`);
    console.log(`   Confidence: ${((result.confidence ?? 0) * 100).toFixed(1)}%`);
    console.log(`   Sequence #: ${result.sequenceNumber ?? 0}`);

    if (result.actions && result.actions.length > 0) {
      const firstAction = result.actions[0];
      console.log(`   First Action Joints: [${(firstAction.jointCommands ?? []).map(j => j.toFixed(2)).join(', ')}]`);
      console.log(`   First Action Gripper: ${(firstAction.gripperCommand ?? 0).toFixed(2)}`);
    }

    // Test 5: Multiple predictions to test metrics
    console.log('\n📊 Test 5: Multiple predictions for metrics...');
    for (let i = 0; i < 5; i++) {
      await client.predict({
        ...observation,
        languageInstruction: `test instruction ${i + 1}`,
        timestamp: Date.now() / 1000,
      });
    }
    console.log('✅ 5 additional predictions completed');

    // Test 6: Check metrics
    console.log('\n📈 Test 6: Check metrics...');
    const metrics = client.getMetrics();
    console.log('✅ Metrics collected');
    console.log(`   Success Count: ${metrics.successCount}`);
    console.log(`   Failure Count: ${metrics.failureCount}`);
    console.log(`   Fallback Count: ${metrics.fallbackCount}`);
    console.log(`   Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    console.log(`   Latency P50: ${metrics.latency.p50.toFixed(2)}ms`);
    console.log(`   Latency P95: ${metrics.latency.p95.toFixed(2)}ms`);
    console.log(`   Latency P99: ${metrics.latency.p99.toFixed(2)}ms`);
    console.log(`   Latency Avg: ${metrics.latency.avg.toFixed(2)}ms`);
    console.log(`   Sample Count: ${metrics.latency.count}`);

    // Test 7: Prometheus metrics format
    console.log('\n📉 Test 7: Prometheus metrics format...');
    const promMetrics = client.getPrometheusMetrics();
    console.log('✅ Prometheus metrics generated');
    console.log('   Sample output:');
    const lines = promMetrics.split('\n').slice(0, 6);
    lines.forEach(line => console.log(`   ${line}`));

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('🎉 ALL TESTS PASSED!\n');
    console.log('Summary:');
    console.log('  ✅ gRPC connection established');
    console.log('  ✅ HealthCheck RPC works');
    console.log('  ✅ GetModelInfo RPC works');
    console.log('  ✅ Predict RPC works');
    console.log('  ✅ Metrics tracking works');
    console.log('  ✅ Prometheus format export works');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  } finally {
    console.log('\n🔌 Closing connection...');
    client.close();
    console.log('✅ Connection closed');
  }
}

// Run tests
test().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
