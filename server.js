const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// قاعدة بيانات للكلمات حسب الفئات
const categories = {
    'حيوانات': ['أسد', 'نمر', 'فيل', 'زرافة', 'ثعلب'],
    'حيوانات بحرية': ['دلفين', 'قرش', 'حوت', 'أخطبوط', 'قنديل البحر'],
    'طيور': ['نسر', 'صقر', 'ببغاء', 'حمامة', 'طاووس'],
    'أكل': ['بيتزا', 'برجر', 'كشري', 'شاورما', 'ملوخية'],
    'ملابس': ['قميص', 'بنطال', 'جاكيت', 'فستان', 'قبعة'],
    'مهن': ['طبيب', 'مهندس', 'معلم', 'طيار', 'شرطي']
};

const rooms = {};

io.on('connection', (socket) => {
    console.log('لاعب جديد اتصل:', socket.id);

    // إنشاء غرفة
    socket.on('createRoom', ({ username }) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = {
            code: roomCode,
            host: socket.id,
            players: [{ id: socket.id, name: username, ready: false, isSpy: false, isEliminated: false }],
            state: 'lobby', // lobby, voting_category, playing, voting_spy
            categoryVotes: {},
            selectedWord: '',
            currentTurnIndex: 0
        };
        
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    // الانضمام لغرفة
    socket.on('joinRoom', ({ username, roomCode }) => {
        const room = rooms[roomCode];
        if (!room) {
            return socket.emit('errorMsg', 'الغرفة غير موجودة!');
        }
        if (room.players.length >= 6) {
            return socket.emit('errorMsg', 'الغرفة مكتملة (6 لاعبين max)!');
        }

        room.players.push({ id: socket.id, name: username, ready: false, isSpy: false, isEliminated: false });
        socket.join(roomCode);
        
        io.to(roomCode).emit('updatePlayers', room.players);
    });

    // الاستعداد وانطلاق العداد
    socket.on('toggleReady', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = !player.ready;

        io.to(roomCode).emit('updatePlayers', room.players);

        // لو كل اللاعبين (4 إلى 6) جاهزين
        const activePlayers = room.players.length;
        const allReady = room.players.every(p => p.ready);

        if (activePlayers >= 4 && allReady) {
            startCategoryVoting(roomCode);
        }
    });

    // فصل الاتصال
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[code];
            } else {
                io.to(code).emit('updatePlayers', room.players);
            }
        }
    });
});

function startCategoryVoting(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.state = 'voting_category';
    io.to(roomCode).emit('startCategoryVote', Object.keys(categories));

    // بعد 10 ثواني نختار الفئة والكلمة والجاسوس
    setTimeout(() => {
        startGame(roomCode);
    }, 10000);
}

function startGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // اختيار فئة عشوائية (أو حسب التصويت)
    const catKeys = Object.keys(categories);
    const chosenCat = catKeys[Math.floor(Math.random() * catKeys.length)];
    const wordList = categories[chosenCat];
    const secretWord = wordList[Math.floor(Math.random() * wordList.length)];
    
    room.selectedWord = secretWord;
    room.state = 'playing';

    // تحديد الجاسوس عشوائياً
    const spyIndex = Math.floor(Math.random() * room.players.length);
    room.players.forEach((p, idx) => {
        p.isSpy = (idx === spyIndex);
    });

    // إرسال الكلمة للمدنيين وتحديد الجاسوس
    room.players.forEach(p => {
        if (p.isSpy) {
            io.to(p.id).emit('gameStarted', { role: 'spy', category: chosenCat });
        } else {
            io.to(p.id).emit('gameStarted', { role: 'civilian', word: secretWord, category: chosenCat });
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
