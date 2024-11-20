import axios from 'axios';
import bencode from 'bencode';
import dgram from 'dgram';
import crypto from 'crypto';

interface Torrent {
    announce: string | string[];
    infoHash: string;
    pieceLength: number;
    pieces: Buffer;
    name: string;
    length: number;
}

interface Peer {
    ip: string;
    port: number;
}

// UDP Tracker Protocol Constants
const ACTIONS = {
    CONNECT: 0,
    ANNOUNCE: 1,
    SCRAPE: 2,
    ERROR: 3
};

export function connectToTrackers(torrent: Torrent, callback: (peers: Peer[]) => void) {
    // Combine multiple tracker sources
    const trackerSources = [
        ...(Array.isArray(torrent.announce) ? torrent.announce : [torrent.announce]),
        // Additional public trackers
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.coppersphere.org:6969/announce',
        'udp://tracker.cyberia.is:6969/announce',
        'http://tracker.ipv6tracker.org:80/announce'
    ];

    // Remove duplicates and filter valid URLs
    const uniqueTrackers = [...new Set(trackerSources)]
        .filter(url => url.startsWith('http://') || url.startsWith('https://') || url.startsWith('udp://'));

    const infoHash = Buffer.from(torrent.infoHash, 'hex');
    const peerId = Buffer.from('-TS0001-' + Math.random().toString(36).slice(2, 12));
    
    let peerList: Peer[] = [];
    let pendingTrackers = uniqueTrackers.length;

    if (pendingTrackers === 0) {
        console.log("No valid trackers found.");
        return callback([]);
    }

    // Track which trackers have been fully processed
    const processTracker = (trackerPeers: Peer[]) => {
        peerList = peerList.concat(trackerPeers);
        pendingTrackers--;

        if (pendingTrackers === 0) {
            console.log(`Total peers discovered: ${peerList.length}`);
            callback(peerList);
        }
    };

    uniqueTrackers.forEach((trackerUrl: string) => {
        try {
            if (trackerUrl.startsWith('udp://')) {
                discoverUDPPeers(trackerUrl, infoHash, peerId, processTracker);
            } else {
                discoverHTTPPeers(trackerUrl, torrent, infoHash, peerId, processTracker);
            }
        } catch (err) {
            console.error(`Tracker discovery error (${trackerUrl}):`, err);
            processTracker([]); // Ensure we still decrement pendingTrackers
        }
    });
}

// Full UDP Tracker Discovery Function (the entire implementation from previous response goes here)

export function discoverUDPPeers(
    trackerUrl: string, 
    infoHash: Buffer, 
    peerId: Buffer, 
    callback: (peers: Peer[]) => void
) {
    const socket = dgram.createSocket('udp4');
    
    // Parse UDP tracker URL
    const [host, portStr] = trackerUrl.replace('udp://', '').split(':');
    const port = parseInt(portStr || '80');

    // Generate unique transaction ID
    const transactionId = crypto.randomBytes(4);

    // Initial connection request
    const connectionId = Buffer.from([0x00, 0x00, 0x04, 0x17, 0x27, 0x10, 0x19, 0x80]);
    const connectRequest = createConnectRequest(connectionId, transactionId);

    // Timeout handling
    const timeout = setTimeout(() => {
        socket.close();
        console.log('UDP Tracker connection timed out');
        callback([]);
    }, 15000);

    socket.send(connectRequest, 0, connectRequest.length, port, host, (err) => {
        if (err) {
            clearTimeout(timeout);
            console.error('UDP Tracker connection error:', err);
            socket.close();
            callback([]);
        }
    });

    // Handle tracker response
    socket.on('message', (msg) => {
        try {
            const action = msg.readUInt32BE(0);
            const receivedTransactionId = msg.slice(4, 8);

            // Validate transaction ID
            if (!receivedTransactionId.equals(transactionId)) {
                console.error('Mismatched transaction ID');
                return;
            }

            switch (action) {
                case ACTIONS.CONNECT:
                    // Extract connection ID from successful connection response
                    const newConnectionId = msg.slice(8, 16);
                    
                    // Create announce request
                    const announceRequest = createAnnounceRequest(
                        newConnectionId, 
                        transactionId, 
                        infoHash, 
                        peerId
                    );

                    // Send announce request
                    socket.send(announceRequest, 0, announceRequest.length, port, host, (err) => {
                        if (err) {
                            console.error('UDP Announce request error:', err);
                        }
                    });
                    break;

                case ACTIONS.ANNOUNCE:
                    // Parse announce response
                    const interval = msg.readUInt32BE(8);
                    const leechers = msg.readUInt32BE(12);
                    const seeders = msg.readUInt32BE(16);

                    console.log(`Tracker stats - Interval: ${interval}, Leechers: ${leechers}, Seeders: ${seeders}`);

                    // Extract peers from response
                    const peers = parseUDPPeers(msg.slice(20));
                    
                    clearTimeout(timeout);
                    socket.close();
                    
                    console.log(`Discovered ${peers.length} peers`);
                    callback(peers);
                    break;

                case ACTIONS.ERROR:
                    const errorMessage = msg.slice(8).toString('utf8');
                    console.error('UDP Tracker error:', errorMessage);
                    socket.close();
                    callback([]);
                    break;

                default:
                    console.error('Unknown UDP tracker response action');
                    socket.close();
                    callback([]);
            }
        } catch (error) {
            console.error('Error processing UDP tracker response:', error);
            socket.close();
            callback([]);
        }
    });

    // Handle socket errors
    socket.on('error', (err) => {
        clearTimeout(timeout);
        console.error('UDP Socket error:', err);
        socket.close();
        callback([]);
    });
}

// Create connection request buffer
function createConnectRequest(connectionId: Buffer, transactionId: Buffer): Buffer {
    return Buffer.concat([
        connectionId,               // 8 bytes connection ID
        Buffer.from([0x00, 0x00, 0x00, ACTIONS.CONNECT]), // 4 bytes action (connect)
        transactionId                // 4 bytes transaction ID
    ]);
}

// Create announce request buffer
function createAnnounceRequest(
    connectionId: Buffer, 
    transactionId: Buffer, 
    infoHash: Buffer, 
    peerId: Buffer
): Buffer {
    const buffer = Buffer.alloc(98);

    // Connection ID (8 bytes)
    connectionId.copy(buffer, 0);

    // Action (4 bytes)
    buffer.writeUInt32BE(ACTIONS.ANNOUNCE, 8);

    // Transaction ID (4 bytes)
    transactionId.copy(buffer, 12);

    // Info hash (20 bytes)
    infoHash.copy(buffer, 16);

    // Peer ID (20 bytes)
    peerId.copy(buffer, 36);

    // Downloaded (8 bytes)
    buffer.writeBigUInt64BE(BigInt(0), 56);

    // Left (8 bytes)
    buffer.writeBigUInt64BE(BigInt(1000000), 64);

    // Uploaded (8 bytes)
    buffer.writeBigUInt64BE(BigInt(0), 72);

    // Event (4 bytes) - 0: none, 1: completed, 2: started, 3: stopped
    buffer.writeUInt32BE(2, 80); // Started

    // IP Address (4 bytes) - 0 means default
    buffer.writeUInt32BE(0, 84);

    // Key (4 bytes) - random number
    crypto.randomBytes(4).copy(buffer, 88);

    // Num want (4 bytes) - number of peers desired, -1 means default
    buffer.writeInt32BE(-1, 92);

    // Port (2 bytes)
    buffer.writeUInt16BE(6881, 96);

    return buffer;
}

// Parse UDP peers from raw buffer
function parseUDPPeers(peersBuffer: Buffer): Peer[] {
    const peers: Peer[] = [];

    // Each peer is 6 bytes (4 bytes IP, 2 bytes port)
    for (let i = 0; i < peersBuffer.length; i += 6) {
        if (i + 5 >= peersBuffer.length) break;

        const ip = [
            peersBuffer[i],
            peersBuffer[i + 1],
            peersBuffer[i + 2],
            peersBuffer[i + 3]
        ].join('.');

        const port = peersBuffer.readUInt16BE(i + 4);

        // Filter out invalid peers
        if (port > 0 && port < 65536) {
            peers.push({ ip, port });
        }
    }

    return peers;
}

// HTTP Peers Discovery Function
async function discoverHTTPPeers(
    trackerUrl: string, 
    torrent: Torrent, 
    infoHash: Buffer, 
    peerId: Buffer, 
    callback: (peers: Peer[]) => void
) {
    try {
        const params = new URLSearchParams({
            info_hash: infoHash.toString('binary'),
            peer_id: peerId.toString('binary'),
            port: '6881',
            uploaded: '0',
            downloaded: '0',
            left: torrent.length.toString(),
            compact: '1',
            event: 'started'
        });

        const fullUrl = `${trackerUrl}?${params.toString()}`;
        
        const response = await axios.get(fullUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'BitTorrent Client'
            }
        });

        const peers = parseHTTPResponse(Buffer.from(response.data));
        callback(peers);
    } catch (err) {
        console.error(`HTTP Tracker error:`, err);
        callback([]);
    }
}

// HTTP Response Parsing Function
function parseHTTPResponse(response: Buffer): Peer[] {
    try {
        const decodedResponse = bencode.decode(response);
        
        if (!decodedResponse || !decodedResponse.peers) {
            console.error('Invalid tracker response');
            return [];
        }

        const peers: Peer[] = [];
        const peersBuffer = decodedResponse.peers;

        if (Buffer.isBuffer(peersBuffer)) {
            for (let i = 0; i < peersBuffer.length; i += 6) {
                const ip = [
                    peersBuffer[i],
                    peersBuffer[i + 1],
                    peersBuffer[i + 2],
                    peersBuffer[i + 3]
                ].join('.');
                const port = peersBuffer.readUInt16BE(i + 4);
                peers.push({ ip, port });
            }
        }

        return peers;
    } catch (error) {
        console.error('Error parsing tracker response:', error);
        return [];
    }
}