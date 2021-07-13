module.exports = function (RED) {

    var Client = require('azure-storage');

    var statusEnum = {
        disconnected: { color: "gray", text: "Disconnected" },
        sending: { color: "green", text: "Sending" },
        sent: { color: "blue", text: "Sent message" },
        error: { color: "red", text: "Error" },
        operational: { color: "blue", text: "Operational" }
    };

    // Main function called by Node-RED    
    function AzureTableStorage(config) {
        let node = this;
        // Create the Node-RED node
        RED.nodes.createNode(this, config);
        
        let clientAccountName = node.credentials.accountname
        let clientAccountKey = node.credentials.key;
        let clientTableService = Client.createTableService(clientAccountName, clientAccountKey);
        
        if (config.debug == true)
            clientTableService.logger.level = Client.Logger.LogLevels.DEBUG;

        const setStatus = (status) => {
            node.status({ fill: status.color, shape: "dot", text: status.text });
        };

        setStatus(statusEnum.operational);

        const formatEntityWithGenerator = (entityClass) => {
            var entGen = Client.TableUtilities.entityGenerator;
            var entity = {
                PartitionKey: entGen.String(entityClass.partitionKey),
                RowKey: entGen.String(entityClass.rowKey),
            };

            // Map data as column if object
            if (entityClass.data === Object(entityClass.data)) {
                for (var key in entityClass.data) {
                    if (entityClass.data.hasOwnProperty(key)) {
                        entity[key] = entGen.String(entityClass.data[key])
                    }
                }
            }
            else {
                entity.data = entGen.String(entityClass.data);
            }

            return entity;
        };

        const sendData = (entityClass) => {
            clientTableService.createTableIfNotExists(entityClass.tableName, function (error, result, response) {
                if (error) {
                    node.error(error);
                }
                else {
                    // Create a message and send it to the Azure Table Storage
                    let entity = formatEntityWithGenerator(entityClass);

                    clientTableService.insertEntity(entityClass.tableName, entity, function (err, result, response) {
                        node.log('trying to insert');
                        if (err) {
                            let newMsg = {
                                payload: {
                                    partitionKey: entityClass.partitionKey,
                                    rowKey: entityClass.rowKey,
                                },
                                status: "Error",
                                message: err.toString()
                            };

                            node.error('Error while trying to save data:' + err.toString());
                            node.send(newMsg);
                            setStatus(statusEnum.error);
                        } else {
                            let newMsg = {
                                payload: {
                                    partitionKey: entityClass.partitionKey,
                                    rowKey: entityClass.rowKey,
                                },
                                status: "OK"
                            };

                            node.log(entityClass.partitionKey + ' saved.');
                            node.send(newMsg);
                            setStatus(statusEnum.sent);
                        }
                    });
                }
            });
        };

        const readData = (entityClass) => {
            clientTableService.retrieveEntity(entityClass.tableName, entityClass.partitionKey, entityClass.rowKey, function (err, result, response) {
                if (err) {
                    let newMsg = {
                        payload: {
                            partitionKey: entityClass.partitionKey,
                            rowKey: entityClass.rowKey,
                        },
                        status: "Error",
                        message: err.toString()
                    };

                    node.error('Error while trying to read data:' + err.toString());
                    node.send(newMsg);
                    setStatus(statusEnum.error);
                } else {
                    let newMsg = {
                        payload: result,
                        status: "OK",
                        partitionKey: entityClass.partitionKey,
                        rowKey: entityClass.rowKey
                    };

                    node.log("Read Data...OK");
                    node.send(newMsg);
                    setStatus(statusEnum.sent);
                }
            });
        }

        const deleteTable = (table) => {
            node.log("Deleting table");
            clientTableService.deleteTable(table, function (err) {
                if (err) {
                    node.error('Error while trying to delete table:' + err.toString());
                    setStatus(statusEnum.error);
                } else {
                    let newMsg = {
                        payload: table,
                        status: "OK"
                    };

                    node.log('table ' + table + ' deleted');
                    node.send(newMsg);
                    setStatus(statusEnum.sent);
                }
            });
        }

        const updateEntity = (entityClass) => {
            node.log('updating entity');
            let entity = formatEntityWithGenerator(entityClass);

            clientTableService.insertOrReplaceEntity(entityClass.tableName, entity, function (err, result, response) {
                if (err) {
                    let newMsg = {
                        payload: {
                            partitionKey: entityClass.partitionKey,
                            rowKey: entityClass.rowKey,
                        },
                        status: "Error",
                        message: err.name + " - " + err.toString(),
                        stack: err.stack
                    };

                    node.error('Error while trying to update' + err.toString());
                    node.send(newMsg);
                    setStatus(statusEnum.error);
                } else {
                    let newMsg = {
                        payload: {
                            partitionKey: entityClass.partitionKey,
                            rowKey: entityClass.rowKey,
                        },
                        status: "OK"
                    };

                    node.log(entityClass.partitionKey + ' updated.');
                    node.send(newMsg);
                    setStatus(statusEnum.sent);
                }
            });
        }

        const deleteEntity = (entityClass) => {
            node.log('deleting entity');

            var entGen = Client.TableUtilities.entityGenerator;
            let entity = {
                PartitionKey: entGen.String(entityClass.partitionKey),
                RowKey: entGen.String(entityClass.rowKey)
            };

            clientTableService.deleteEntity(entityClass.tableName, entity, function (err, result, response) {
                if (err) {
                    let newMsg = {
                        payload: {
                            partitionKey: entityClass.partitionKey,
                            rowKey: entityClass.rowKey,
                        },
                        status: "Error",
                        message: err.toString()
                    };

                    node.send(newMsg);
                    node.error('Error while trying to delete entity:' + err.toString());
                    setStatus(statusEnum.error);
                } else {
                    let newMsg = {
                        payload: {
                            partitionKey: entityClass.partitionKey,
                            rowKey: entityClass.rowKey,
                        },
                        status: "OK"
                    };

                    node.send(newMsg);
                    node.log('entity deleted');
                    setStatus(statusEnum.sent);
                }
            });
        }


        const queryEntity = (entityClass) => {
            node.log('query entity');

            let top = entityClass.top ? entityClass.top : 0;

            var query = new Client.TableQuery()
                .top(top)
                .where(entityClass.fromcolumn + ' eq ?', entityClass.where);

            clientTableService.queryEntities(entityClass.tableName, query, null, function (err, result, response) {
                if (err) {
                    let newMsg = {
                        payload: entityClass,
                        status: "Error",
                        message: err.toString()
                    };

                    node.error('Error while trying to save data:' + err.toString());
                    node.send(newMsg);
                    setStatus(statusEnum.error);
                } else {
                    let newMsg = {
                        payload: result.entries,
                        status: "OK"
                    };

                    node.log("queried " + entityClass.tableName + "...OK");
                    node.send(newMsg);
                    setStatus(statusEnum.sent);
                }
            });
        }

        const disconnectFrom = () => {
            if (clientTableService) {
                node.log('Disconnecting from Azure');
                clientTableService.removeAllListeners();
                clientTableService = null;
                setStatus(statusEnum.disconnected);
            }
        }

        this.on('input', (msg) => {
            let entityClass = {};
            let messageJSON = null;

            if (typeof (msg.payload) != "string") {
                node.log("JSON");
                messageJSON = msg.payload;
            } else {
                node.log("String");
                //Converting string to JSON Object if msg.payload is String
                //Sample string: {"tableName": "name", "action": "I" "partitionKey": "part1", "rowKey": "row1", "data": "data"}
                messageJSON = JSON.parse(msg.payload);
            }

            entityClass = messageJSON;
            node.log('Received the input: ' + messageJSON.tableName);

            let action = messageJSON.action;
            setStatus(statusEnum.sending);

            switch (action) {
                case "I":
                    node.log('Trying to insert entity');
                    sendData(entityClass);
                    break;
                case "R":
                    node.log('Trying to read entity');
                    readData(entityClass);
                    break;
                case "DT":
                    node.log('Trying to delete table');
                    deleteTable(entityClass.tableName);
                    break;
                case "Q":
                    node.log('Trying to query data');
                    queryEntity(entityClass);
                    break;
                case "U":
                    node.log('trying to update entity');
                    updateEntity(entityClass);
                    break;
                case "D":
                    node.log('trying to delete entity');
                    deleteEntity(entityClass)
                    break;
                default:
                    node.log('action was not detected');
                    node.error('action was not detected');
                    setStatus(statusEnum.error);
                    break;
            }
        });

        this.on('close', () => disconnectFrom(this));
    }

    // Registration of the node into Node-RED
    RED.nodes.registerType("Aleph Table Storage", AzureTableStorage, {
        credentials: {
            accountname: { type: "text" },
            key: { type: "text" }
        },
        defaults: {
            name: { value: "Aleph Table Storage" },
            debug: { value: false }
        }
    });
}