import net from 'net';

export function downloadPiece(peer: { ip: string; port: number }, pieceIndex: number, callback: (data: Buffer) => void) {
    const socket = net.createConnection(peer.port, peer.ip, () => {
        const request = Buffer.alloc(10); // Placeholder size for piece request
        socket.write(request);
    });

    socket.on('data', (data) => {
        callback(data);
        socket.end();
    });
}
