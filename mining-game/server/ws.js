'use strict';

// 极简 WebSocket 服务端：只做这个游戏需要的两件事——
//   1. 完成握手（Sec-WebSocket-Accept）
//   2. 给客户端发文本帧；收到文本帧时交给 onmessage
// 不依赖任何 npm 包，够用就行。

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = 1;
    this.buffer = Buffer.alloc(0);
    // 连接断了、写失败都会走这里：只标记关闭，不往外抛，否则会带崩整个进程。
    socket.on('data', (chunk) => {
      try {
        this.receive(chunk);
      } catch {
        this.readyState = 3;
      }
    });
    socket.on('close', () => {
      this.readyState = 3;
      this.emit('close');
    });
    socket.on('error', () => {
      this.readyState = 3;
      try {
        socket.destroy();
      } catch {
        // 已经没了
      }
      this.emit('close');
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this.parseFrame();
      if (!frame) return;
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.writeFrame(0xa, frame.payload);
        continue;
      }
      if (frame.opcode === 0x1) this.emit('message', frame.payload.toString('utf8'));
    }
  }

  parseFrame() {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return null;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) return null;
    let payload = buffer.subarray(offset + maskLength, offset + maskLength + length);
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      const copy = Buffer.from(payload);
      for (let i = 0; i < copy.length; i += 1) copy[i] ^= mask[i % 4];
      payload = copy;
    }
    this.buffer = buffer.subarray(offset + maskLength + length);
    return { opcode, payload };
  }

  writeFrame(opcode, payload) {
    if (this.readyState !== 1) return;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x80 | opcode, data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, data]));
    } catch {
      this.readyState = 3;
    }
  }

  send(text) {
    this.writeFrame(0x1, text);
  }

  close() {
    if (this.readyState === 1) this.writeFrame(0x8, Buffer.alloc(0));
    this.readyState = 3;
    this.socket.end();
  }
}

class WebSocketServer {
  handleUpgrade(request, socket, head, callback) {
    // 握手前就要接住错误：浏览器中途关掉页面时这里会 ECONNRESET。
    socket.on('error', () => {
      try {
        socket.destroy();
      } catch {
        // 已经没了
      }
    });
    const key = request.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(`${key}${GUID}`).digest('base64');
    try {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    } catch {
      socket.destroy();
      return;
    }
    const client = new Socket(socket);
    if (head && head.length > 0) client.receive(head);
    callback(client);
  }
}

module.exports = { WebSocketServer, Socket };
