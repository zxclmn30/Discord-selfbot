
const { Client, CustomStatus } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
    checkUpdate: false,
    readyStatus: false
});

const DEFAULT_PREFIX = process.env.PREFIX || '.';
const ALLOWED_PREFIXES = Array.from(new Set([DEFAULT_PREFIX, '.', '!']));

const state = {
    tagInterval: null,
    tagList: [],
    tagIndex: 0,
    spamInterval: null,
    groupRenameInterval: null,
    extraction: {
        active: false,
        stopRequested: false,
        serverName: '',
        channelName: '',
        totalMessages: 0,
        currentCount: 0,
        filePath: ''
    },
    voiceChannel: null
};

const getRandomString = (len = 8) => {
    return Math.random().toString(36).substring(2, 2 + len);
};

const getRandomNumber = (min = 1000, max = 9999) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const exportsDir = path.join(__dirname, 'exports');
if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
}

const TAG_STATE_FILE = path.join(__dirname, 'tag_state.json');

const saveTagState = (data) => {
    try {
        fs.writeFileSync(TAG_STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[-] Failed to save tag_state.json:', e.message);
    }
};

const loadTagState = () => {
    try {
        if (fs.existsSync(TAG_STATE_FILE)) {
            const raw = fs.readFileSync(TAG_STATE_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('[-] Failed to read tag_state.json:', e.message);
    }
    return null;
};

const startTagRotation = async (client, serverIds, startIndex = 0) => {
    if (state.tagInterval) {
        clearInterval(state.tagInterval);
        state.tagInterval = null;
    }

    state.tagList = serverIds;
    state.tagIndex = startIndex % serverIds.length;

    const switchTag = async () => {
        if (!state.tagList || state.tagList.length === 0) return;
        const currentGuildId = state.tagList[state.tagIndex];
        state.tagIndex = (state.tagIndex + 1) % state.tagList.length;

        try {
            await client.api.users('@me', 'clan').put({
                data: {
                    identity_enabled: true,
                    identity_guild_id: currentGuildId
                }
            });
            const guild = client.guilds.cache.get(currentGuildId);
            const guildName = guild ? guild.name : currentGuildId;
            console.log(`[+] Primary Clan Tag switched to: ${guildName} (${currentGuildId})`);
        } catch (err) {
            console.error(`[-] Failed to switch tag to ${currentGuildId}:`, err.message || err);
        }

        saveTagState({
            active: true,
            serverIds: state.tagList,
            index: state.tagIndex
        });
    };

    await switchTag();
    state.tagInterval = setInterval(switchTag, 10000);

    saveTagState({
        active: true,
        serverIds: state.tagList,
        index: state.tagIndex
    });
};

const stopTagRotation = async (client) => {
    if (state.tagInterval) {
        clearInterval(state.tagInterval);
        state.tagInterval = null;
    }
    state.tagList = [];
    state.tagIndex = 0;

    saveTagState({
        active: false,
        serverIds: [],
        index: 0
    });

    try {
        await client.api.users('@me', 'clan').put({
            data: {
                identity_enabled: false,
                identity_guild_id: null
            }
        });
    } catch {
        try {
            await client.api.users('@me', 'clan').delete();
        } catch {}
    }
};

const resolveTargetUser = async (client, message, targetArg) => {
    
    if (message.mentions.users.size > 0) {
        return message.mentions.users.first();
    }
    
    if (targetArg) {
        const cleanId = targetArg.replace(/[<@!>]/g, '').trim();
        if (/^\d{17,20}$/.test(cleanId)) {
            const cached = client.users.cache.get(cleanId);
            if (cached) return cached;

            try {
                
                const profile = await client.api.users(cleanId).profile.get({
                    query: {
                        with_mutual_guilds: false,
                        with_mutual_friends_count: false
                    }
                });
                if (profile?.user) {
                    return client.users._add(profile.user);
                }
            } catch {
                return null;
            }
        }
    }
    return null;
};

const formatTime = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${hours > 0 ? `${hours}시간 ` : ''}${minutes}분 ${seconds}초`;
};

client.on('ready', async () => {
    console.log(`[+] Selfbot Authenticated: ${client.user.tag} (${client.user.id})`);
    console.log(`[+] Active Guilds: ${client.guilds.cache.size}`);

    const persisted = loadTagState();
    if (persisted?.active && Array.isArray(persisted.serverIds) && persisted.serverIds.length > 0) {
        console.log(`[+] Resuming persisted tag rotation across ${persisted.serverIds.length} servers...`);
        startTagRotation(client, persisted.serverIds, persisted.index || 0);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.id !== client.user.id) return;

    const matchedPrefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!matchedPrefix) return;

    const rawArgs = message.content.slice(matchedPrefix.length).trim().split(/ +/);
    const command = rawArgs.shift()?.toLowerCase();
    const args = rawArgs;
    const prefixUsed = matchedPrefix;

    try {
        switch (command) {
            
            case '프사':
            case 'avatar': {
                const target = (await resolveTargetUser(client, message, args[0])) || message.author;
                const avatarUrl = target.displayAvatarURL({ dynamic: true, size: 4096 });
                await message.edit([
                    `> ## 프로필 사진 - ${target.tag}`,
                    '> ',
                    `> - **유저 ID** - \`${target.id}\``,
                    `> - **원본 링크** - [클릭하여 열기](${avatarUrl})`,
                    '> ',
                    `${avatarUrl}`
                ].join('\n'));
                break;
            }

            case '배너':
            case 'banner': {
                const target = (await resolveTargetUser(client, message, args[0])) || message.author;
                let bannerUrl = null;

                try {
                    
                    const profileData = await client.api.users(target.id).profile.get({
                        query: {
                            with_mutual_guilds: false,
                            with_mutual_friends_count: false,
                            guild_id: message.guild?.id
                        }
                    });

                    if (profileData?.user) {
                        target._patch(profileData.user);
                    }

                    const bannerHash = profileData?.user?.banner || target.banner;
                    if (bannerHash) {
                        const extension = bannerHash.startsWith('a_') ? 'gif' : 'png';
                        bannerUrl = `https://cdn.discordapp.com/banners/${target.id}/${bannerHash}.${extension}?size=4096`;
                    }
                } catch {
                    
                    bannerUrl = target.bannerURL?.({ dynamic: true, size: 4096 }) || null;
                }

                if (!bannerUrl) {
                    await message.edit([
                        `> ## 프로필 배너 - ${target.tag}`,
                        '> ',
                        `> - **알림** - 등록된 배너가 없습니다.`
                    ].join('\n'));
                    return;
                }

                await message.edit([
                    `> ## 프로필 배너 - ${target.tag}`,
                    '> ',
                    `> - **유저 ID** - \`${target.id}\``,
                    `> - **원본 링크** - [클릭하여 열기](${bannerUrl})`,
                    '> ',
                    `${bannerUrl}`
                ].join('\n'));
                break;
            }

            case '유저정보':
            case 'userinfo': {
                const target = (await resolveTargetUser(client, message, args[0])) || message.author;
                const member = message.guild?.members.cache.get(target.id);
                const createdAt = new Date(target.createdTimestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                const joinedAt = member ? new Date(member.joinedTimestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '서버 미참여';

                await message.edit([
                    `> ## 유저 정보 - ${target.tag}`,
                    '> ',
                    `> - **유저 태그** - \`${target.tag}\``,
                    `> - **유저 ID** - \`${target.id}\``,
                    `> - **계정 생성일** - \`${createdAt}\``,
                    `> - **서버 참여일** - \`${joinedAt}\``,
                    `> - **봇 여부** - \`${target.bot ? 'BOT' : '일반 유저'}\``,
                    `> - **서버 닉네임** - \`${member?.nickname || '기본값'}\``
                ].join('\n'));
                break;
            }

            case '서버정보':
            case 'serverinfo': {
                if (!message.guild) {
                    await message.edit('> [오류] 서버 채널에서만 사용할 수 있는 명령어입니다.');
                    return;
                }

                const guild = message.guild;
                const createdAt = new Date(guild.createdTimestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                const textChannels = guild.channels.cache.filter(c => c.type === 'GUILD_TEXT').size;
                const voiceChannels = guild.channels.cache.filter(c => c.type === 'GUILD_VOICE').size;

                await message.edit([
                    `> ## 서버 정보 - ${guild.name}`,
                    '> ',
                    `> - **서버 ID** - \`${guild.id}\``,
                    `> - **소유자 ID** - \`${guild.ownerId}\``,
                    `> - **서버 개설일** - \`${createdAt}\``,
                    `> - **멤버 수** - \`${guild.memberCount.toLocaleString()}명\``,
                    `> - **채널 구성** - \`채팅 ${textChannels}개 / 음성 ${voiceChannels}개\``,
                    `> - **역할 개수** - \`${guild.roles.cache.size}개\``,
                    `> - **부스트 레벨** - \`레벨 ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0}개 부스트)\``
                ].join('\n'));
                break;
            }

            case 'ping':
            case '핑': {
                const start = Date.now();
                await message.edit('> 측정 중...');
                const latency = Date.now() - start;
                const wsPing = client.ws.ping >= 0 ? client.ws.ping.toFixed(2) : '0.00';

                await message.edit([
                    '> ## 연결 상태',
                    '> ',
                    `> - **Gateway 핑** - \`${wsPing} ms\``,
                    `> - **클라이언트 응답 지연** - \`${latency.toFixed(2)} ms\``
                ].join('\n'));
                break;
            }

            case '추첨':
            case 'pick': {
                if (args.length < 2) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}추첨 <항목1> <항목2> [항목3...]\``
                    ].join('\n'));
                    return;
                }

                const picked = args[Math.floor(Math.random() * args.length)];
                await message.edit([
                    '> ## 무작위 추첨 결과',
                    '> ',
                    `> - **후보 목록** - \`${args.join(', ')}\``,
                    `> - **선택된 항목** - **\`${picked}\`**`
                ].join('\n'));
                break;
            }

            case '상태':
            case 'status': {
                const uptimeFormatted = formatTime(client.uptime);
                const wsPing = client.ws.ping >= 0 ? `${client.ws.ping.toFixed(2)} ms` : '측정 불가';
                const tagStatus = state.tagInterval ? `실행 중 (대상: ${state.tagList.length}개 서버)` : '정지됨';
                const extractStatus = state.extraction.active ? `작업 진행 중 (${state.extraction.currentCount}개 수집)` : '대기 중';
                const voiceStatus = state.voiceChannel ? `연결됨 (\`${state.voiceChannel.name}\`)` : '미연결';

                await message.edit([
                    '> ## 시스템 종합 상태',
                    '> ',
                    `> - **실행 시간** - \`${uptimeFormatted}\``,
                    `> - **게이트웨이** - \`${wsPing}\``,
                    `> - **음성 채널** - \`${voiceStatus}\``,
                    `> - **태그 순환** - \`${tagStatus}\``,
                    `> - **메시지 추출** - \`${extractStatus}\``
                ].join('\n'));
                break;
            }

            case '추출': {
                const targetGuildId = args[0];
                const targetSubId = args[1];

                if (!targetGuildId) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}추출 <서버ID> [채널ID 또는 카테고리ID]\``
                    ].join('\n'));
                    return;
                }

                if (state.extraction.active) {
                    await message.edit('> [알림] 이미 진행 중인 추출 작업이 있습니다.');
                    return;
                }

                const guild = client.guilds.cache.get(targetGuildId);
                if (!guild) {
                    await message.edit('> [오류] 해당 서버에 참여하고 있지 않거나 유효하지 않은 서버 ID입니다.');
                    return;
                }

                let targetChannels = [];
                if (targetSubId) {
                    const channel = guild.channels.cache.get(targetSubId);
                    if (!channel) {
                        await message.edit('> [오류] 지정한 채널 또는 카테고리를 찾을 수 없습니다.');
                        return;
                    }
                    if (channel.type === 'GUILD_CATEGORY') {
                        targetChannels = guild.channels.cache.filter(c => c.parentId === channel.id && c.isText()).map(c => c);
                    } else if (channel.isText()) {
                        targetChannels = [channel];
                    }
                } else {
                    targetChannels = guild.channels.cache.filter(c => c.isText()).map(c => c);
                }

                if (targetChannels.length === 0) {
                    await message.edit('> [오류] 추출 가능한 텍스트 채널이 없습니다.');
                    return;
                }

                const fileName = `export_${guild.id}_${Date.now()}.txt`;
                const filePath = path.join(exportsDir, fileName);

                state.extraction = {
                    active: true,
                    stopRequested: false,
                    serverName: guild.name,
                    channelName: targetSubId ? (targetChannels[0]?.name || 'Category') : '전체 채널',
                    totalMessages: 0,
                    currentCount: 0,
                    filePath
                };

                await message.edit([
                    '> ## 메시지 추출 시작',
                    '> ',
                    `> - **대상 서버** - \`${guild.name}\` (\`${guild.id}\`)`,
                    `> - **추출 대상** - \`${targetChannels.length}개 채널\``,
                    `> - **저장 파일** - \`${fileName}\``
                ].join('\n'));

                (async () => {
                    const writeStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
                    writeStream.write(`=== 서버 [${guild.name}] 메시지 추출 기록 ===\n추출 일시: ${new Date().toISOString()}\n\n`);

                    for (const ch of targetChannels) {
                        if (state.extraction.stopRequested) break;
                        writeStream.write(`\n--- 채널: #${ch.name} (${ch.id}) ---\n`);

                        let lastId = null;
                        while (!state.extraction.stopRequested) {
                            try {
                                const fetchOptions = { limit: 100 };
                                if (lastId) fetchOptions.before = lastId;

                                const messages = await ch.messages.fetch(fetchOptions);
                                if (!messages || messages.size === 0) break;

                                for (const [, msg] of messages) {
                                    const timeStr = new Date(msg.createdTimestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                                    writeStream.write(`[${timeStr}] ${msg.author.tag} (${msg.author.id}): ${msg.cleanContent || '[첨부/임베드]'}\n`);
                                    state.extraction.currentCount++;
                                }

                                lastId = messages.last()?.id;
                                await new Promise(r => setTimeout(r, 600));
                            } catch {
                                break;
                            }
                        }
                    }

                    writeStream.end();
                    state.extraction.active = false;
                })();

                break;
            }

            case '추출상태': {
                if (!state.extraction.active) {
                    await message.edit([
                        '> ## 추출 상태',
                        '> ',
                        `> - **현재 상태** - \`진행 중인 추출 작업 없음\``
                    ].join('\n'));
                    return;
                }

                await message.edit([
                    '> ## 추출 상태',
                    '> ',
                    `> - **대상 서버** - \`${state.extraction.serverName}\``,
                    `> - **대상 범위** - \`${state.extraction.channelName}\``,
                    `> - **현재 수집량** - \`${state.extraction.currentCount.toLocaleString()}개 메시지\``,
                    `> - **저장 경로** - \`${state.extraction.filePath}\``
                ].join('\n'));
                break;
            }

            case '추출중지': {
                if (!state.extraction.active) {
                    await message.edit('> [알림] 실행 중인 추출 작업이 없습니다.');
                    return;
                }

                state.extraction.stopRequested = true;
                await message.edit([
                    '> ## 메시지 추출 중지',
                    '> ',
                    `> - **완료 메시지 수** - \`${state.extraction.currentCount.toLocaleString()}개\``,
                    `> - **상태** - \`추출 프로세스를 안전하게 종료했습니다.\``
                ].join('\n'));
                break;
            }

            case 'v': {
                const targetInput = args[0];
                if (!targetInput) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}v <음성채널 링크 또는 채널ID>\``
                    ].join('\n'));
                    return;
                }

                let channelId = targetInput;
                const linkMatch = targetInput.match(/channels\/\d+\/(\d+)/);
                if (linkMatch) {
                    channelId = linkMatch[1];
                }

                const channel = client.channels.cache.get(channelId);
                if (!channel || (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE')) {
                    await message.edit('> [오류] 유효한 음성 채널을 찾을 수 없습니다.');
                    return;
                }

                try {
                    await client.voice.joinChannel(channel, {
                        selfDeaf: false,
                        selfMute: false
                    });
                    state.voiceChannel = channel;

                    await message.edit([
                        '> ## 음성 채널 입장 완료',
                        '> ',
                        `> - **채널명** - \`${channel.name}\``,
                        `> - **서버** - \`${channel.guild.name}\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 음성 채널 입장 실패: \`${err.message}\``);
                }
                break;
            }

            case 'vafk': {
                if (!message.guild) {
                    await message.edit('> [오류] 서버 내에서 실행해야 합니다.');
                    return;
                }

                const afkChannel = message.guild.afkChannel;
                if (!afkChannel) {
                    await message.edit('> [오류] 해당 서버에는 지정된 잠수(AFK) 채널이 없습니다.');
                    return;
                }

                try {
                    await client.voice.joinChannel(afkChannel, {
                        selfDeaf: true,
                        selfMute: true
                    });
                    state.voiceChannel = afkChannel;

                    await message.edit([
                        '> ## AFK 채널 입장',
                        '> ',
                        `> - **채널명** - \`${afkChannel.name}\``,
                        `> - **상태** - \`마이크 및 헤드셋 음소거 적용됨\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] AFK 채널 입장 실패: \`${err.message}\``);
                }
                break;
            }

            case 'lv': {
                if (client.voice?.connection) {
                    client.voice.connection.disconnect();
                    state.voiceChannel = null;
                    await message.edit([
                        '> ## 음성 채널 퇴장',
                        '> ',
                        `> - **상태** - \`음성 연결 해제 완료\``
                    ].join('\n'));
                } else {
                    await message.edit('> [알림] 현재 입장 중인 음성 채널이 없습니다.');
                }
                break;
            }

            case '그룹통방':
            case '그룹통화':
            case 'groupcall': {
                if (message.channel.type !== 'GROUP_DM') {
                    await message.edit('> [오류] 그룹 DM(그룹 통방)에서만 사용할 수 있는 명령어입니다.');
                    return;
                }

                await message.edit('> 그룹 통화 연결 및 신호 전송 중...');

                try {
                    await client.voice.joinChannel(message.channel, {
                        selfDeaf: false,
                        selfMute: false
                    });
                    state.voiceChannel = message.channel;

                    await message.channel.ring().catch(() => {});

                    const recipientCount = (message.channel.recipients?.size || 0) + 1;
                    const groupTitle = message.channel.name || '이름 없는 그룹';

                    await message.edit([
                        '> ## 그룹 통방 연결 완료',
                        '> ',
                        `> - **그룹방** - \`${groupTitle}\``,
                        `> - **통화 인원** - \`${recipientCount}명\``,
                        `> - **상태** - \`음성 통화 입장 및 그룹 벨소리 송신됨\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 그룹 통화 시작 실패: \`${err.message}\``);
                }
                break;
            }

            case '그룹변경':
            case '그룹이름':
            case 'groupname': {
                if (message.channel.type !== 'GROUP_DM') {
                    await message.edit('> [오류] 그룹 DM(그룹방)에서만 사용할 수 있는 명령어입니다.');
                    return;
                }

                const newName = args.join(' ').replace(/^[\s(]+|[\s)]+$/g, '').trim();

                if (!newName) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}그룹변경 (새이름)\``
                    ].join('\n'));
                    return;
                }

                const prevName = message.channel.name || '이름 없음';

                try {
                    await message.channel.setName(newName);
                    await message.edit([
                        '> ## 그룹방 이름 변경 완료',
                        '> ',
                        `> - **기존 이름** - \`${prevName}\``,
                        `> - **변경된 이름** - \`${newName}\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 그룹방 이름 변경 실패: \`${err.message}\``);
                }
                break;
            }

            case '그룹이름테러': {
                if (message.channel.type !== 'GROUP_DM') {
                    await message.edit('> [오류] 그룹 DM(그룹방)에서만 사용할 수 있는 명령어입니다.');
                    return;
                }

                const baseTitle = args.join(' ').replace(/^[\s(]+|[\s)]+$/g, '').trim();
                if (!baseTitle) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}그룹이름테러 (내용)\``
                    ].join('\n'));
                    return;
                }

                if (state.groupRenameInterval) {
                    clearInterval(state.groupRenameInterval);
                    state.groupRenameInterval = null;
                }

                await message.delete().catch(() => {});

                const channel = message.channel;
                state.groupRenameInterval = setInterval(async () => {
                    const randomNum = getRandomNumber(1000, 9999);
                    const formattedTitle = `${baseTitle} ${randomNum}`;
                    try {
                        await channel.setName(formattedTitle);
                    } catch (e) {
                        
                    }
                }, 1500);
                break;
            }

            case '그룹정지': {
                if (!state.groupRenameInterval) {
                    await message.edit('> [알림] 현재 실행 중인 그룹 이름 테러가 없습니다.');
                    return;
                }

                clearInterval(state.groupRenameInterval);
                state.groupRenameInterval = null;

                await message.edit([
                    '> ## 그룹 이름 테러 중지',
                    '> ',
                    `> - **상태** - \`그룹방 이름 반복 변경이 정상적으로 정지되었습니다.\``
                ].join('\n'));
                break;
            }

            case '글자근성': {
                const textContent = args.join(' ').replace(/^[\s(]+|[\s)]+$/g, '').trim();
                if (!textContent) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}글자근성 (내용)\``
                    ].join('\n'));
                    return;
                }

                if (state.spamInterval) {
                    clearInterval(state.spamInterval);
                    state.spamInterval = null;
                }

                await message.delete().catch(() => {});

                const targetChannel = message.channel;
                state.spamInterval = setInterval(async () => {
                    const randomStr = getRandomString(8);
                    const payload = `${textContent}\n-# ${randomStr}`;
                    try {
                        await targetChannel.send(payload);
                    } catch {}
                }, 1200);
                break;
            }

            case '근성': {
                const textContent = args.join(' ').replace(/^[\s(]+|[\s)]+$/g, '').trim();
                if (!textContent) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}근성 (내용)\``
                    ].join('\n'));
                    return;
                }

                if (state.spamInterval) {
                    clearInterval(state.spamInterval);
                    state.spamInterval = null;
                }

                await message.delete().catch(() => {});

                const targetChannel = message.channel;
                state.spamInterval = setInterval(async () => {
                    const randomStr = getRandomString(8);
                    const payload = `A\n\n\n\n\n\n\n\nA\n\n\n\n\n\n\n\n\nA\n\n${textContent}\n-# ${randomStr}`;
                    try {
                        await targetChannel.send(payload);
                    } catch {}
                }, 1200);
                break;
            }

            case '근성중지': {
                if (!state.spamInterval) {
                    await message.edit('> [알림] 현재 실행 중인 근성 작업이 없습니다.');
                    return;
                }

                clearInterval(state.spamInterval);
                state.spamInterval = null;

                await message.edit([
                    '> ## 근성 작업 중지',
                    '> ',
                    `> - **상태** - \`반복 메시지 전송 루프가 정상적으로 정지되었습니다.\``
                ].join('\n'));
                break;
            }

            case '청소': {
                const count = parseInt(args[0], 10);
                if (isNaN(count) || count < 1) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}청소 <숫자>\``
                    ].join('\n'));
                    return;
                }

                await message.delete().catch(() => {});
                const fetched = await message.channel.messages.fetch({ limit: Math.min(count, 100) });
                let deletedCount = 0;

                for (const [, msg] of fetched) {
                    await msg.delete().catch(() => {});
                    deletedCount++;
                    await new Promise(r => setTimeout(r, 600));
                }

                const alertMsg = await message.channel.send([
                    '> ## 메시지 청소 완료',
                    '> ',
                    `> - **삭제된 메시지** - \`${deletedCount}개\``
                ].join('\n'));

                setTimeout(() => alertMsg.delete().catch(() => {}), 3000);
                break;
            }

            case '메시지삭제':
            case '개인청소': {
                const targetCount = parseInt(args[0], 10);
                if (isNaN(targetCount) || targetCount < 1) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}메시지삭제 <개수>\``
                    ].join('\n'));
                    return;
                }

                await message.delete().catch(() => {});

                let deletedCount = 0;
                let lastMessageId = null;
                const channel = message.channel;

                while (deletedCount < targetCount) {
                    const fetchOptions = { limit: 100 };
                    if (lastMessageId) fetchOptions.before = lastMessageId;

                    const fetched = await channel.messages.fetch(fetchOptions).catch(() => null);
                    if (!fetched || fetched.size === 0) break;

                    const myMessages = fetched.filter(m => m.author.id === client.user.id);
                    if (myMessages.size === 0 && fetched.size < 100) break;

                    for (const [, msg] of myMessages) {
                        if (deletedCount >= targetCount) break;
                        await msg.delete().catch(() => {});
                        deletedCount++;
                        await new Promise(r => setTimeout(r, 600)); 
                    }

                    lastMessageId = fetched.last()?.id;
                    if (!lastMessageId || fetched.size < 100 && deletedCount >= myMessages.size) {
                        
                        break;
                    }
                }

                const alertMsg = await channel.send([
                    '> ## 메시지 삭제 완료',
                    '> ',
                    `> - **삭제된 본인 메시지** - \`${deletedCount}개 / 요청 ${targetCount}개\``
                ].join('\n')).catch(() => null);

                if (alertMsg) {
                    setTimeout(() => alertMsg.delete().catch(() => {}), 3000);
                }
                break;
            }

            case '킥': {
                if (!message.guild) {
                    await message.edit('> [오류] 서버에서만 사용할 수 있는 관리자 명령어입니다.');
                    return;
                }

                const targetUser = await resolveTargetUser(client, message, args[0]);
                if (!targetUser) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}킥 <@유저 또는 ID> [사유]\``
                    ].join('\n'));
                    return;
                }

                const reasonArgs = message.mentions.users.size > 0 
                    ? args.filter(a => !a.startsWith('<@')) 
                    : args.slice(1);
                const reason = reasonArgs.join(' ') || '사유 미지정';

                const member = await message.guild.members.fetch(targetUser.id).catch(() => null);
                if (!member) {
                    await message.edit('> [오류] 해당 서버에서 대상을 찾을 수 없습니다.');
                    return;
                }

                try {
                    await member.kick(reason);
                    await message.edit([
                        '> ## 유저 킥(추방) 완료',
                        '> ',
                        `> - **대상** - \`${targetUser.tag}\` (\`${targetUser.id}\`)`,
                        `> - **사유** - \`${reason}\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 추방 실패 (권한 부족 또는 역할 순위 미달): \`${err.message}\``);
                }
                break;
            }

            case '밴': {
                if (!message.guild) {
                    await message.edit('> [오류] 서버에서만 사용할 수 있는 관리자 명령어입니다.');
                    return;
                }

                const targetUser = await resolveTargetUser(client, message, args[0]);
                if (!targetUser) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}밴 <@유저 또는 ID> [사유] [일수]\``
                    ].join('\n'));
                    return;
                }

                let days = 0;
                const reasonArgs = message.mentions.users.size > 0 
                    ? args.filter(a => !a.startsWith('<@')) 
                    : args.slice(1);

                const lastArgNum = parseInt(reasonArgs[reasonArgs.length - 1], 10);
                if (!isNaN(lastArgNum) && lastArgNum >= 0 && lastArgNum <= 7) {
                    days = lastArgNum;
                    reasonArgs.pop();
                }
                const reason = reasonArgs.join(' ') || '사유 미지정';

                try {
                    const banOptions = { reason };
                    if (days > 0) {
                        banOptions.deleteMessageSeconds = days * 86400; 
                    }
                    await message.guild.members.ban(targetUser.id, banOptions);
                    await message.edit([
                        '> ## 유저 밴(차단) 완료',
                        '> ',
                        `> - **대상** - \`${targetUser.tag}\` (\`${targetUser.id}\`)`,
                        `> - **메시지 삭제 일수** - \`${days}일\``,
                        `> - **사유** - \`${reason}\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 차단 실패 (권한 부족 또는 역할 순위 미달): \`${err.message}\``);
                }
                break;
            }

            case '언밴': {
                if (!message.guild) {
                    await message.edit('> [오류] 서버에서만 사용할 수 있는 관리자 명령어입니다.');
                    return;
                }

                const targetId = args[0]?.replace(/[<@!>]/g, '').trim();
                if (!targetId || !/^\d{17,20}$/.test(targetId)) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}언밴 <유저ID> [사유]\``
                    ].join('\n'));
                    return;
                }

                const reason = args.slice(1).join(' ') || '사유 미지정';

                try {
                    await message.guild.bans.remove(targetId, reason);
                    await message.edit([
                        '> ## 유저 언밴(차단 해제) 완료',
                        '> ',
                        `> - **대상 ID** - \`${targetId}\``,
                        `> - **사유** - \`${reason}\``
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 차단 해제 실패: \`${err.message}\``);
                }
                break;
            }

            case '스티커스틸': {
                let targetSticker = null;
                const rawServerId = (args[0] || '').replace(/[^\d]/g, '');

                if (message.reference?.messageId) {
                    let refMsg = null;
                    try {
                        refMsg = await Promise.resolve(message.channel.messages.fetch(message.reference.messageId));
                    } catch {
                        refMsg = null;
                    }

                    if (refMsg && refMsg.stickers?.size > 0) {
                        targetSticker = refMsg.stickers.first();
                    }
                }

                if (!targetSticker && message.stickers?.size > 0) {
                    targetSticker = message.stickers.first();
                }

                if (!targetSticker && rawServerId && /^\d{17,20}$/.test(rawServerId)) {
                    try {
                        targetSticker = await client.fetchSticker(rawServerId);
                    } catch {
                        targetSticker = null;
                    }
                }

                if (!targetSticker) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - 스티커 메시지에 답장하면서 \`${prefixUsed}스티커스틸 (서버ID)\``
                    ].join('\n'));
                    return;
                }

                if (targetSticker.partial) {
                    await targetSticker.fetch().catch(() => {});
                }

                const targetGuildId = (/^\d{17,20}$/.test(rawServerId) ? rawServerId : null) || message.guild?.id;

                if (!targetGuildId) {
                    await message.edit('> [오류] 스티커를 등록할 서버 ID를 입력해주세요. 예: `!스티커스틸 123456789012345678`');
                    return;
                }

                let targetGuild = client.guilds.cache.get(targetGuildId);
                if (!targetGuild) {
                    targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
                }

                if (!targetGuild) {
                    await message.edit(`> [오류] 해당 서버(\`${targetGuildId}\`)를 찾을 수 없거나 본인 계정이 참여 중이지 않습니다.`);
                    return;
                }

                if (targetSticker.format === 'LOTTIE') {
                    await message.edit('> [오류] 공식 Lottie 벡터 스티커(기본 제공 애니메이션)는 디스코드 서버 스티커로 등록할 수 없습니다. 일반 PNG/APNG/GIF 커스텀 스티커를 사용해주세요.');
                    return;
                }

                await message.edit('> 스티커 원본 다운로드 및 규격 검증 중...');

                const isGif = targetSticker.format === 'GIF';
                const ext = isGif ? 'gif' : 'png';
                const mimeType = isGif ? 'image/gif' : 'image/png';
                const rawCdnUrl = `https://cdn.discordapp.com/stickers/${targetSticker.id}.${ext}`;

                let buffer;
                try {
                    const res = await fetch(rawCdnUrl);
                    if (!res.ok) {
                        throw new Error(`CDN 다운로드 실패 (HTTP ${res.status})`);
                    }
                    const arrayBuffer = await res.arrayBuffer();
                    buffer = Buffer.from(arrayBuffer);
                } catch (dlErr) {
                    await message.edit(`> [오류] 스티커 파일 추출 실패: \`${dlErr.message}\``);
                    return;
                }

                const isPngHeader = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
                const isGifHeader = buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;

                let finalMime = mimeType;
                let finalExt = ext;
                if (isGifHeader) {
                    finalMime = 'image/gif';
                    finalExt = 'gif';
                } else if (isPngHeader) {
                    finalMime = 'image/png';
                    finalExt = 'png';
                }

                const stickerName = (targetSticker.name || 'stolen_sticker').replace(/[^a-zA-Z0-9가-힣_]/g, '').slice(0, 30) || 'sticker';
                const stickerTags = targetSticker.tags || '✨';

                try {
                    
                    const formData = new FormData();
                    const blob = new Blob([buffer], { type: finalMime });
                    formData.append('file', blob, `sticker.${finalExt}`);
                    formData.append('name', stickerName);
                    formData.append('tags', stickerTags);
                    formData.append('description', '');

                    const uploadRes = await fetch(`https://discord.com/api/v9/guilds/${targetGuild.id}/stickers`, {
                        method: 'POST',
                        headers: {
                            'Authorization': client.token
                        },
                        body: formData
                    });

                    const json = await uploadRes.json().catch(() => ({}));

                    if (!uploadRes.ok) {
                        const errMsg = json.message || JSON.stringify(json);
                        throw new Error(errMsg);
                    }

                    if (targetGuild.stickers?._add) {
                        targetGuild.stickers._add(json);
                    }

                    const stickerViewUrl = `https://cdn.discordapp.com/stickers/${json.id}.${finalExt}`;

                    await message.edit([
                        '> ## 스티커 스틸 완료',
                        '> ',
                        `> - **스티커명** - \`${json.name}\``,
                        `> - **서버** - \`${targetGuild.name}\` (\`${targetGuild.id}\`)`,
                        `> - **스티커 ID** - \`${json.id}\``,
                        `> - **미리보기 링크** - [클릭하여 확인](${stickerViewUrl})`
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 스티커 생성 실패: \`${err.message}\``);
                }
                break;
            }

            case '이모지스틸': {
                const emojiRaw = args[0];
                const targetGuildId = args[1] || message.guild?.id;

                if (!emojiRaw || !targetGuildId) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **사용법** - \`${prefixUsed}이모지스틸 <이모지> [서버ID]\``
                    ].join('\n'));
                    return;
                }

                const emojiMatch = emojiRaw.match(/<(a)?:(\w+):(\d+)>/);
                if (!emojiMatch) {
                    await message.edit('> [오류] 커스텀 이모지만 스틸할 수 있습니다.');
                    return;
                }

                const [, isAnimated, emojiName, emojiId] = emojiMatch;
                const extension = isAnimated ? 'gif' : 'png';
                const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}?size=4096`;

                const targetGuild = client.guilds.cache.get(targetGuildId);
                if (!targetGuild) {
                    await message.edit('> [오류] 대상 서버를 찾을 수 없습니다.');
                    return;
                }

                try {
                    const createdEmoji = await targetGuild.emojis.create(emojiUrl, emojiName);
                    await message.edit([
                        '> ## 이모지 스틸 완료',
                        '> ',
                        `> - **이모지명** - \`${createdEmoji.name}\``,
                        `> - **서버** - \`${targetGuild.name}\``,
                        `> - **미리보기** - ${createdEmoji.toString()}`
                    ].join('\n'));
                } catch (err) {
                    await message.edit(`> [오류] 이모지 생성 실패: \`${err.message}\``);
                }
                break;
            }

            case '태그': {
                const subCommand = args[0]?.toLowerCase();

                if (subCommand === 'stop') {
                    if (!state.tagInterval && !loadTagState()?.active) {
                        await message.edit('> [알림] 현재 실행 중인 태그 순환이 없습니다.');
                        return;
                    }
                    await stopTagRotation(client);

                    await message.edit([
                        '> ## 태그 순환 중지',
                        '> ',
                        `> - **상태** - \`태그 자동 순환 스케줄러가 종료되고 서버 태그가 해제되었습니다.\``
                    ].join('\n'));
                    return;
                }

                if (args.length === 0) {
                    await message.edit([
                        '> ## 명령어 안내',
                        '> ',
                        `> - **시작** - \`${prefixUsed}태그 <서버ID1> <서버ID2> ...\``,
                        `> - **중지** - \`${prefixUsed}태그 stop\``
                    ].join('\n'));
                    return;
                }

                const serverIds = args.map(a => a.trim()).filter(id => /^\d{17,20}$/.test(id));
                if (serverIds.length === 0) {
                    await message.edit('> [오류] 유효한 서버 ID(숫자)를 1개 이상 입력해주세요.');
                    return;
                }

                await startTagRotation(client, serverIds, 0);

                const serverNameList = serverIds.map(id => {
                    const g = client.guilds.cache.get(id);
                    return g ? `${g.name} (\`${id}\`)` : `\`${id}\``;
                }).join(', ');

                await message.edit([
                    '> ## 서버 태그 시작 ',
                    '> ',
                    `> - **순환 대상** - ${serverNameList}`,
                    `> - **주기** - \`10초 간격\``,
                    `> - **중지 명령** - \`${prefixUsed}태그 stop\``
                ].join('\n'));
                break;
            }

            case '명령어':
            case '도움말':
            case 'help': {
                const helpScreen = [
                    '> ## 정보 · 도구',
                    `> - **\`${prefixUsed}프사 [@유저 또는 ID]\`** - 프로필 사진 보기`,
                    `> - **\`${prefixUsed}배너 [@유저 또는 ID]\`** - 프로필 배너 보기`,
                    `> - **\`${prefixUsed}유저정보 [@유저 또는 ID]\`** - 기본값은 본인`,
                    `> - **\`${prefixUsed}서버정보\`** - 현재 서버 정보`,
                    `> - **\`${prefixUsed}ping\`** - 연결 핑 측정`,
                    `> - **\`${prefixUsed}추첨 <항목1> <항목2> ...\`** - 항목 중 하나 선택`,
                    `> - **\`${prefixUsed}상태\`** - 연결·실행 시간·대기 명령·태그 순환 상태`,
                    `> - **\`${prefixUsed}추출 <서버ID> [채널ID 또는 카테고리ID]\`** - 메시지 TXT 저장`,
                    `> - **\`${prefixUsed}추출상태\`** / **\`${prefixUsed}추출중지\`** - 추출 확인·중단`,
                    '> ',
                    '> ## 음성 · 통화 · 그룹',
                    `> - **\`${prefixUsed}v <음성채널 링크>\`** - 링크의 서버 음성채널 입장`,
                    `> - **\`${prefixUsed}vafk\`** - 지정된 음성채널 입장`,
                    `> - **\`${prefixUsed}lv\`** - 음성 퇴장 · 입장 대기 취소`,
                    `> - **\`${prefixUsed}그룹통방\`** - 현재 그룹 DM 통화 시작 및 멤버 호출`,
                    `> - **\`${prefixUsed}그룹변경 (새이름)\`** - 현재 그룹 DM 이름 변경`,
                    `> - **\`${prefixUsed}그룹이름테러 (내용)\`** - 그룹방 이름을 내용+랜덤숫자로 연속 변경`,
                    `> - **\`${prefixUsed}그룹정지\`** - 그룹방 이름 연속 변경 중지`,
                    '> ',
                    '> ## 연속 전송 · 근성',
                    `> - **\`${prefixUsed}글자근성 (내용)\`** - 내용+랜덤문자열 연속 전송`,
                    `> - **\`${prefixUsed}근성 (내용)\`** - A패턴+내용+랜덤문자열 연속 전송`,
                    `> - **\`${prefixUsed}근성중지\`** - 근성 반복 전송 작업 중단`,
                    '> ',
                    '> ## 메시지 · 운영',
                    `> - **\`${prefixUsed}청소 <숫자>\`** - 현재 채널의 최근 메시지 일괄 삭제`,
                    `> - **\`${prefixUsed}메시지삭제 <개수>\`** - 현재 채널에서 내가 보낸 메시지만 지정 개수만큼 삭제`,
                    `> - **\`${prefixUsed}킥 <@유저> [사유]\`** - 서버에서 유저 추방`,
                    `> - **\`${prefixUsed}밴 <@유저> [사유] [일수]\`** - 밴 및 최근 메시지 삭제`,
                    `> - **\`${prefixUsed}언밴 <유저ID> [사유]\`** - 밴 해제`,
                    '> ',
                    '> ## 이모지 · 스티커 · 태그',
                    `> - **\`${prefixUsed}이모지스틸 <이모지> [서버ID]\`** - 서버 이모지 복사 및 등록`,
                    `> - **\`${prefixUsed}스티커스틸 [스티커ID] [서버ID]\`** - 스티커 메시지 답장 또는 ID로 스티커 복사`,
                    `> - **\`${prefixUsed}태그 <서버ID1> <서버ID2> ...\`** - 최소 10초 간격 태그 순환`,
                    `> - **\`${prefixUsed}태그 stop\`** - 태그 순환 중지`,
                    `> - **\`${prefixUsed}명령어\`** - 이 도움말 출력`
                ].join('\n');

                await message.edit(helpScreen);
                break;
            }

            default:
                break;
        }
    } catch (err) {
        console.error(`[-] Command [${command}] execution error:`, err);
    }
});

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error('[-] Error: TOKEN not specified in .env');
    process.exit(1);
}

client.login(TOKEN).catch((err) => {
    console.error('[-] Login failed:', err.message);
});
