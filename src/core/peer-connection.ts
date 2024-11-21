import net from 'net';

export function downloadPiece(
    peer: { ip: string; port: number }, 
    pieceIndex: number, 
    callback: (data: Buffer | null) => void
) {
    const socket = net.createConnection({
        host: peer.ip,
        port: peer.port,
        timeout: 10000  // 10-second timeout
    });

    // Timeout handler
    const connectionTimeout = setTimeout(() => {
        console.error(`Connection to ${peer.ip}:${peer.port} timed out`);
        socket.destroy();
        callback(null);
    }, 10000);

    socket.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log(`Connected to peer ${peer.ip}:${peer.port}`);
        
        // Simplified piece request - you'll want to implement full BitTorrent protocol
        const request = Buffer.alloc(10); // Placeholder for piece request
        socket.write(request);
    });

    socket.on('data', (data) => {
        clearTimeout(connectionTimeout);
        callback(data);
        socket.end();
    });

    socket.on('error', (err) => {
        clearTimeout(connectionTimeout);
        console.error(`Connection error with ${peer.ip}:${peer.port}:`, err.message);
        callback(null);
    });

    socket.on('timeout', () => {
        console.error(`Connection to ${peer.ip}:${peer.port} timed out`);
        socket.destroy();
        callback(null);
    });
}