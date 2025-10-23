// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBinaryBuffer } from '../../test/fixtures/test-data';
import type { MockWebSocketConstructor } from '../../test/types/test-types';
import { MockWebSocket } from '../../test/utils/lit-test-utils';
import type { BufferSnapshot } from '../utils/terminal-renderer';
import { BufferSubscriptionService } from './buffer-subscription-service';

// Mock the terminal renderer module
vi.mock('../utils/terminal-renderer.js', () => ({
  TerminalRenderer: {
    decodeBinaryBuffer: vi.fn((data: ArrayBuffer, _previous?: BufferSnapshot): BufferSnapshot => {
      // Check magic bytes
      const view = new DataView(data);
      if (view.byteLength < 2) {
        throw new Error('Invalid buffer format');
      }
      const magic = view.getUint16(0, false);
      if (magic !== 0x5654) {
        // "VT"
        throw new Error('Invalid buffer format');
      }

      return {
        cols: 80,
        rows: 24,
        viewportY: 0,
        cursorX: 2,
        cursorY: 0,
        cells: [],
      };
    }),
  },
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('BufferSubscriptionService', () => {
  let service: BufferSubscriptionService;
  let mockWebSocketConstructor: typeof MockWebSocket;
  let mockWebSocketInstance: MockWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, 'setTimeout');
    vi.spyOn(global, 'clearTimeout');
    vi.spyOn(global, 'setInterval');
    vi.spyOn(global, 'clearInterval');

    // Mock window object for Node environment
    if (typeof window === 'undefined') {
      global.window = {
        location: { host: 'localhost', protocol: 'http:' },
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
      } as unknown as Window & typeof globalThis;
    } else {
      // Mock window.location.host
      Object.defineProperty(window, 'location', {
        value: { host: 'localhost', protocol: 'http:' },
        writable: true,
      });
    }

    // Create a mock WebSocket instance
    mockWebSocketInstance = new MockWebSocket('ws://localhost/buffers');

    // Mock WebSocket constructor to always return the same instance
    mockWebSocketConstructor = vi.fn().mockImplementation(() => {
      // Set up the mock instance each time it's created
      mockWebSocketInstance.binaryType = 'arraybuffer';
      return mockWebSocketInstance;
    }) as unknown as MockWebSocketConstructor;
    mockWebSocketConstructor.CONNECTING = 0;
    mockWebSocketConstructor.OPEN = 1;
    mockWebSocketConstructor.CLOSING = 2;
    mockWebSocketConstructor.CLOSED = 3;

    global.WebSocket = mockWebSocketConstructor as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (service) {
      service.dispose();
    }
    // Clean up global window mock
    if (typeof window === 'undefined' && global.window) {
      delete (global as { window?: unknown }).window;
    }
  });

  describe('connection management', () => {
    it('should connect to WebSocket on initialization', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      await service.initialize();

      // Advance timers to trigger connection after delay
      vi.advanceTimersByTime(100);

      expect(mockWebSocketConstructor).toHaveBeenCalledWith('ws://localhost/buffers');
      expect(mockWebSocketInstance.binaryType).toBe('arraybuffer');
    });

    it('should handle successful connection', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      await service.initialize();
      vi.advanceTimersByTime(100);

      // Simulate successful connection
      mockWebSocketInstance.mockOpen();

      expect(mockWebSocketInstance.readyState).toBe(WebSocket.OPEN);
    });

    it('should handle connection errors', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      await service.initialize();
      vi.advanceTimersByTime(100);

      // Simulate connection error followed by close
      mockWebSocketInstance.mockError();
      mockWebSocketInstance.mockClose();

      // Should schedule reconnect
      expect(setTimeout).toHaveBeenCalled();
    });

    it('should reconnect with exponential backoff', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      await service.initialize();
      vi.advanceTimersByTime(100);

      // First reconnect - 1 second
      mockWebSocketInstance.mockClose();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

      // Advance time and trigger reconnect
      vi.advanceTimersByTime(1000);

      // Second reconnect - 2 seconds
      mockWebSocketInstance.mockClose();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);

      // Third reconnect - 4 seconds
      vi.advanceTimersByTime(2000);
      mockWebSocketInstance.mockClose();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 4000);
    });

    it('should cap reconnect delay at 30 seconds', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      await service.initialize();
      vi.advanceTimersByTime(100);

      // Trigger many failed connections
      for (let i = 0; i < 10; i++) {
        mockWebSocketInstance.mockClose();
        vi.advanceTimersByTime(30000);
      }

      // Should still be capped at 30 seconds
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 30000);
    });
  });

  describe('subscription management', () => {
    beforeEach(async () => {
      service = new BufferSubscriptionService();
    });

    it('should subscribe to a session', async () => {
      const handler = vi.fn();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      // Initialize the service first
      await service.initialize();

      // Advance timers to trigger connection
      vi.advanceTimersByTime(100);

      // Subscribe to a session
      const unsubscribe = service.subscribe('session-123', handler);

      // Simulate successful connection
      mockWebSocketInstance.mockOpen();

      // When connecting, the service re-subscribes to all sessions
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', sessionId: 'session-123' })
      );

      expect(typeof unsubscribe).toBe('function');
    });

    it('should not send duplicate subscribe messages for same session', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      // Initialize and connect first
      await service.initialize();
      vi.advanceTimersByTime(100);
      mockWebSocketInstance.mockOpen();

      // Subscribe first handler
      service.subscribe('session-123', handler1);

      // Should send one subscribe message
      expect(mockWebSocketInstance.send).toHaveBeenCalledTimes(1);
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', sessionId: 'session-123' })
      );

      // Clear previous calls
      mockWebSocketInstance.send.mockClear();

      // Subscribe second handler to same session
      service.subscribe('session-123', handler2);

      // Should not send another subscribe message
      expect(mockWebSocketInstance.send).not.toHaveBeenCalled();
    });

    it('should unsubscribe when last handler is removed', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      // Initialize and connect first
      await service.initialize();
      vi.advanceTimersByTime(100);
      mockWebSocketInstance.mockOpen();

      // Subscribe handlers
      const unsubscribe1 = service.subscribe('session-123', handler1);
      const unsubscribe2 = service.subscribe('session-123', handler2);

      // Clear previous calls
      mockWebSocketInstance.send.mockClear();

      // Remove first handler - should not unsubscribe yet
      unsubscribe1();
      expect(mockWebSocketInstance.send).not.toHaveBeenCalled();

      // Remove second handler - should unsubscribe
      unsubscribe2();
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'unsubscribe', sessionId: 'session-123' })
      );
    });

    it('should queue subscribe messages when disconnected', async () => {
      const handler = vi.fn();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      // Initialize and connect
      await service.initialize();
      vi.advanceTimersByTime(100);
      mockWebSocketInstance.mockOpen();

      // Subscribe to first session
      service.subscribe('session-123', handler);

      // Then close connection
      mockWebSocketInstance.mockClose();

      // Try to subscribe to another session while disconnected
      service.subscribe('session-456', handler);

      // Create new mock instance for reconnection
      const newMockInstance = new MockWebSocket('ws://localhost/buffers');
      mockWebSocketConstructor.mockReturnValue(newMockInstance);

      // Advance time to trigger reconnect
      vi.advanceTimersByTime(1000);

      // Simulate successful reconnection
      newMockInstance.mockOpen();

      // Should send subscribe messages for both sessions on reconnection
      expect(newMockInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', sessionId: 'session-123' })
      );
      expect(newMockInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', sessionId: 'session-456' })
      );
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      await service.initialize();
      vi.advanceTimersByTime(100);
      mockWebSocketInstance.mockOpen();
    });

    it('should handle ping messages', () => {
      mockWebSocketInstance.mockMessage(JSON.stringify({ type: 'ping' }));

      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
    });

    it('should handle connected messages', () => {
      mockWebSocketInstance.mockMessage(
        JSON.stringify({
          type: 'connected',
          version: '1.0.0',
        })
      );

      // Should log the connection (mocked logger)
    });

    it('should handle error messages', () => {
      mockWebSocketInstance.mockMessage(
        JSON.stringify({
          type: 'error',
          message: 'Session not found',
        })
      );

      // Should log the error (mocked logger)
    });

    it('should handle binary buffer updates', async () => {
      const handler = vi.fn();
      service.subscribe('session-123', handler);

      // Create a mock binary message
      const sessionId = 'session-123';
      const sessionIdBytes = new TextEncoder().encode(sessionId);
      const totalLength = 1 + 4 + sessionIdBytes.length + mockBinaryBuffer.length;
      const message = new ArrayBuffer(totalLength);
      const view = new DataView(message);
      const uint8View = new Uint8Array(message);

      // Magic byte
      view.setUint8(0, 0xbf);

      // Session ID length
      view.setUint32(1, sessionIdBytes.length, true);

      // Session ID
      uint8View.set(sessionIdBytes, 5);

      // Buffer data
      uint8View.set(mockBinaryBuffer, 5 + sessionIdBytes.length);

      // Send binary message
      mockWebSocketInstance.mockMessage(message);

      // Wait for dynamic import
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });

      // Handler should receive decoded buffer
      expect(handler).toHaveBeenCalledWith({
        cols: 80,
        rows: 24,
        viewportY: 0,
        cursorX: 2,
        cursorY: 0,
        cells: [],
      });
    });

    it('should ignore binary messages with invalid magic byte', () => {
      const handler = vi.fn();
      service.subscribe('session-123', handler);

      // Create message with wrong magic byte
      const message = new ArrayBuffer(10);
      const view = new DataView(message);
      view.setUint8(0, 0xff); // Wrong magic byte

      mockWebSocketInstance.mockMessage(message);

      // Don't run timers - the message should be ignored immediately
      // Handler should not be called
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on dispose', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      // Initialize and connect
      await service.initialize();
      vi.advanceTimersByTime(100);

      // Verify WebSocket was created
      expect(mockWebSocketConstructor).toHaveBeenCalled();

      mockWebSocketInstance.mockOpen();

      // WebSocket should be connected now
      expect(mockWebSocketInstance.readyState).toBe(WebSocket.OPEN);

      // Subscribe to ensure there's activity
      const handler = vi.fn();
      service.subscribe('session-123', handler);

      service.dispose();

      expect(mockWebSocketInstance.close).toHaveBeenCalled();
      // Should clear interval for ping/pong
      expect(clearInterval).toHaveBeenCalled();
    });

    it('should clear all subscriptions on dispose', async () => {
      service = new BufferSubscriptionService();

      // Mock fetch for auth config check
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ noAuth: true }),
      } as Response);

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe('session-1', handler1);

      // Wait for auth check
      await vi.waitFor(() => {
        const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
        return calls.length > 0;
      });

      // Advance timers to trigger connection
      vi.advanceTimersByTime(100);
      mockWebSocketInstance.mockOpen();

      service.subscribe('session-2', handler2);

      service.dispose();

      // Try to send a message after dispose - handlers should not be called
      const message = new ArrayBuffer(100);
      mockWebSocketInstance.mockMessage(message);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});
