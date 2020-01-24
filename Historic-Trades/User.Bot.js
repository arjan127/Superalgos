﻿
exports.newUserBot = function newUserBot(bot, logger, COMMONS, UTILITIES, fileStorage, STATUS_REPORT, EXCHANGE_API) {

    const FULL_LOG = true;
    const LOG_FILE_CONTENT = false;
    const GMT_SECONDS = ':00.000 GMT+0000';
    const GMT_MILI_SECONDS = '.000 GMT+0000';
    const MODULE_NAME = "User Bot";
    const TRADES_FOLDER_NAME = "Trades";

    thisObject = {
        initialize: initialize,
        start: start
    };

    let utilities = UTILITIES.newCloudUtilities(bot, logger)
    let statusDependencies

    const ONE_MINUTE = 60000
    const MAX_TRADES_PER_EXECUTION = 100000
    const symbol = bot.market.baseAsset + '/' + bot.market.quotedAsset
    const ccxt = require('ccxt')

    let allTrades = []
    let thisReport;
    let since
    let initialProcessTimestamp
    let beginingOfMarket
    let lastFileSaved

    return thisObject;

    function initialize(pStatusDependencies, pMonth, pYear, callBackFunction) {
        try {

            logger.fileName = MODULE_NAME;
            logger.initialize();

            statusDependencies = pStatusDependencies;
            callBackFunction(global.DEFAULT_OK_RESPONSE);

        } catch (err) {
            logger.write(MODULE_NAME, "[ERROR] initialize -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function start(callBackFunction) {
        try {

            begin()

            async function begin() {
                getContextVariables()
                defineSince()
                await getTrades()
                await saveTrades()
            }

            function getContextVariables() {

                try {
                    let reportKey;

                    reportKey = "AAMasters" + "-" + "AACharly" + "-" + "Historic-Trades" + "-" + "dataSet.V1";
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getContextVariables -> reportKey = " + reportKey); }

                    if (statusDependencies.statusReports.get(reportKey).status === "Status Report is corrupt.") {
                        logger.write(MODULE_NAME, "[ERROR] start -> getContextVariables -> Can not continue because dependecy Status Report is corrupt. ");
                        callBackFunction(global.DEFAULT_RETRY_RESPONSE);
                        return;
                    }

                    thisReport = statusDependencies.statusReports.get(reportKey)

                    if (thisReport.file.beginingOfMarket !== undefined) { // This means this is not the first time this process run.
                        beginingOfMarket = new Date(thisReport.file.beginingOfMarket.year + "-" + thisReport.file.beginingOfMarket.month + "-" + thisReport.file.beginingOfMarket.days + " " + thisReport.file.beginingOfMarket.hours + ":" + thisReport.file.beginingOfMarket.minutes + GMT_SECONDS);
                        lastFileSaved = new Date(thisReport.file.lastFileSaved.year + "-" + thisReport.file.lastFileSaved.month + "-" + thisReport.file.lastFileSaved.days + " " + thisReport.file.lastFileSaved.hours + ":" + thisReport.file.lastFileSaved.minutes + GMT_SECONDS);
                    } else {  // This means this is the first time this process run.
                        beginingOfMarket = new Date()
                    }
                } catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> getContextVariables -> err = " + err.stack);
                    if (err.message === "Cannot read property 'file' of undefined") {
                        logger.write(MODULE_NAME, "[HINT] start -> getContextVariables -> Check the bot Status Dependencies. ");
                        logger.write(MODULE_NAME, "[HINT] start -> getContextVariables -> Dependencies loaded -> keys = " + JSON.stringify(statusDependencies.keys));
                    }
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }

            function defineSince() {

                let uiStartDate = new Date(bot.uiStartDate)

                if (uiStartDate.valueOf() < beginingOfMarket.valueOf()) {
                    since = (new Date(bot.uiStartDate)).valueOf()
                    initialProcessTimestamp = since 
                    beginingOfMarket = new Date(uiStartDate.valueOf())
                } else {
                    since = lastFileSaved.valueOf()
                    initialProcessTimestamp = lastFileSaved.valueOf()
                }
            }

            async function getTrades() {

                let lastTradeKey = ''

                const limit = 1000
                const exchangeId = bot.exchange.toLowerCase()
                const exchangeClass = ccxt[exchangeId]
                const exchange = new exchangeClass({
                    'timeout': 30000,
                    'enableRateLimit': true//,
                     //verbose: true
                })

                try {

                    while (since < exchange.milliseconds()) {

                        /* Reporting we are doing well */
                        let processingDate = new Date(since)
                        processingDate = processingDate.getUTCFullYear() + '-' + utilities.pad(processingDate.getUTCMonth() + 1, 2) + '-' + utilities.pad(processingDate.getUTCDate(), 2);
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> getTrades -> Fetching Trades  @ " + processingDate + "-> exchange = " + bot.exchange + " -> symbol = " + symbol + " -> since = " + since + " -> limit = " + limit ) }
                        console.log("Charly -> " + MODULE_NAME + " -> start -> getTrades -> Fetching Trades from " + bot.exchange + " " + symbol + " @ " + processingDate)
                        bot.processHeartBeat("Fetching " + bot.exchange + " " + symbol + " @ " + processingDate) // tell the world we are alive and doing well

                        /* Fetching the trades from the exchange.*/
                        const trades = await exchange.fetchTrades(symbol, since, limit)

                        if (trades.length > 1 && allTrades.length < MAX_TRADES_PER_EXECUTION) {
                            since = trades[trades.length - 1]['timestamp']

                            for (let i = 0; i < trades.length; i++) {
                                let trade = trades[i]
                                let tradeKey = trade.timestamp + '-' + trade.side + '-' + trade.price.toFixed(16) + '-' + trade.amount.toFixed(16)
                                if (tradeKey !== lastTradeKey) {
                                    allTrades.push([trade.timestamp, trade.side, trade.price, trade.amount])
                                }
                                lastTradeKey = tradeKey
                            }

                        } else {
                            break
                        }
                    }
                } catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> getTrades -> err = " + err.stack);
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }

            async function saveTrades() {

                try {

                    let fileContent = '['
                    let previousRecordMinute = Math.trunc((initialProcessTimestamp - ONE_MINUTE) / ONE_MINUTE)  
                    let currentRecordMinute
                    let needSeparator = false
                    let error
                    let separator
                    let heartBeatCounter = 0

                    let i = -1
                    controlLoop()

                    function loop() {

                        let filesToCreate = 0
                        let filesCreated = 0

                        let record = allTrades[i]
                        let trade = {
                            timestamp: record[0],
                            side: record[1],
                            price: record[2],
                            amount: record[3]
                        }

                        /* Reporting we are doing well */
                        heartBeatCounter--
                        if (heartBeatCounter <= 0) {
                            heartBeatCounter = 1000
                            let processingDate = new Date(trade.timestamp)
                            processingDate = processingDate.getUTCFullYear() + '-' + utilities.pad(processingDate.getUTCMonth() + 1, 2) + '-' + utilities.pad(processingDate.getUTCDate(), 2);
                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] start -> saveTrades -> Saving Trades  @ " + processingDate + " -> i = " + i + " -> total = " + allTrades.length) }
                            console.log("Charly -> " + MODULE_NAME + " -> start -> saveTrades -> Saving Trades from " + bot.exchange + " " + symbol + " @ " + processingDate)
                            bot.processHeartBeat("Saving " + bot.exchange + " " + symbol + " @ " + processingDate) // tell the world we are alive and doing well
                        }

                        /* Saving the trades in Files*/
                        currentRecordMinute = Math.trunc(trade.timestamp / ONE_MINUTE)

                        if (
                            currentRecordMinute !== previousRecordMinute
                        ) {
                            /* There are no more trades at this minute or it is the last trade, so we save the file.*/
                            saveFile()
                        }

                        if (needSeparator === false) {
                            needSeparator = true;
                            separator = '';
                        } else {
                            separator = ',';
                        }

                        /* Add the trade to the file content.*/
                        fileContent = fileContent + separator + '[' + trade.timestamp + ',"' + trade.side + '",' + trade.price + ',' + trade.amount + ']';

                        if (i === allTrades.length) {
                            /* This is the last trade, so we save the file.*/
                            saveFile()
                            /* It might happen that there are several minutes after the last trade without trades. We need to record empty files for them.*/
                            if (allTrades.length < MAX_TRADES_PER_EXECUTION) {
                                let currentTimeMinute = Math.trunc((new Date()).valueOf() / ONE_MINUTE)
                                if (currentTimeMinute - currentRecordMinute > 1) {
                                    createMissingEmptyFiles(currentRecordMinute, currentTimeMinute)
                                }
                            }
                            return
                        }
                        previousRecordMinute = currentRecordMinute
                        if (error) {
                            callBackFunction(error);
                            return;
                        }
                        if (filesToCreate === 0) {
                            controlLoop()
                        }
                        function saveFile() {
                            fileContent = fileContent + ']'
                            if (currentRecordMinute - previousRecordMinute > 1) {
                                createMissingEmptyFiles(previousRecordMinute, currentRecordMinute)
                            }
                            let fileName = bot.market.baseAsset + '_' + bot.market.quotedAsset + '.json'
                            filesToCreate++
                            fileStorage.createTextFile(bot.dataMine, getFilePath(currentRecordMinute * ONE_MINUTE) + '/' + fileName, fileContent + '\n', onFileCreated);
                            fileContent = '['
                            needSeparator = false

                        }
                        function createMissingEmptyFiles(begin, end) {

                            for (let j = begin + 1; j < end; j++) {
                                let fileName = bot.market.baseAsset + '_' + bot.market.quotedAsset + '.json'
                                filesToCreate++
                                fileStorage.createTextFile(bot.dataMine, getFilePath(j * ONE_MINUTE) + '/' + fileName, "[]" + '\n', onFileCreated);

                            }
                        }
                        function onFileCreated(err) {
                            if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                                logger.write(MODULE_NAME, "[ERROR] start -> tradesReadyToBeSaved -> onFileBCreated -> err = " + JSON.stringify(err));
                                error = err // This allows the loop to be breaked.
                                return;
                            }
                            filesCreated++
                            lastFileSaved = new Date((currentRecordMinute * ONE_MINUTE))
                            if (filesCreated === filesToCreate) {
                                controlLoop()
                            }
                        }
                        function getFilePath(timestamp) {
                            let datetime = new Date(timestamp)
                            let dateForPath = datetime.getUTCFullYear() + '/' +
                                utilities.pad(datetime.getUTCMonth() + 1, 2) + '/' +
                                utilities.pad(datetime.getUTCDate(), 2) + '/' +
                                utilities.pad(datetime.getUTCHours(), 2) + '/' +
                                utilities.pad(datetime.getUTCMinutes(), 2)
                            let filePath = bot.filePathRoot + "/Output/" + TRADES_FOLDER_NAME + '/' + dateForPath;
                            return filePath
                        }


                    }
                    function controlLoop() {
                        i++
                        if (i < allTrades.length) {
                            loop()
                        } else {
                            writeStatusReport()
                        }
                    }
 
                } catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> saveTrades -> err = " + err.stack);
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }

            function writeStatusReport() {
                try {
                    if (lastFileSaved === undefined) {return}
                    thisReport.file = {
                        lastFileSaved: {
                            year: lastFileSaved.getUTCFullYear(),
                            month: (lastFileSaved.getUTCMonth() + 1),
                            days: lastFileSaved.getUTCDate(),
                            hours: lastFileSaved.getUTCHours(),
                            minutes: lastFileSaved.getUTCMinutes()
                        },
                        beginingOfMarket: {
                            year: beginingOfMarket.getUTCFullYear(),
                            month: (beginingOfMarket.getUTCMonth() + 1),
                            days: beginingOfMarket.getUTCDate(),
                            hours: beginingOfMarket.getUTCHours(),
                            minutes: beginingOfMarket.getUTCMinutes()
                        },
                        completeHistory: true
                    };

                    thisReport.save(onSaved);

                    function onSaved(err) {
                        if (err.result !== global.DEFAULT_OK_RESPONSE.result) {
                            logger.write(MODULE_NAME, "[ERROR] start -> writeStatusReport -> onSaved -> err = " + err.stack);
                            callBackFunction(err);
                            return;
                        }
                        callBackFunction(global.DEFAULT_OK_RESPONSE);
                    }
                } catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] start -> writeStatusReport -> err = " + err.stack);
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }


        } catch (err) {
            logger.write(MODULE_NAME, "[ERROR] start -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }
};
