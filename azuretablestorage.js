module.exports = function (RED) {

    var Client = require('azure-storage');    
    var clientAccountName = "";
    var clientAccountKey = "";    

    var statusEnum = {
        disconnected: { color: "red", text: "Disconnected" },
        sending: { color: "green", text: "Sending" },
        sent: { color: "blue", text: "Sent message" },
        error: { color: "grey", text: "Error" },
        operational: { color: "blue", text: "Operational" }
    };    

    // Main function called by Node-RED    
    function AzureTableStorage(config) {
        // Store node for further use
        let node = this;        

        // Create the Node-RED node
        RED.nodes.createNode(this, config);
        clientAccountName = node.credentials.accountname
        clientAccountKey = node.credentials.key;
        var clientTableService = Client.createTableService(clientAccountName, clientAccountKey);
        
        const setStatus = (status) => {
            node.status({ fill: status.color, shape: "dot", text: status.text });
        };
        
        setStatus(statusEnum.operational);
        const sendData = (entityClass) => {
            clientTableService.createTableIfNotExists(entityClass.tableName, function (error, result, response) {
                if (error) {
                    node.error(error);
                }
                else {
                    // Create a message and send it to the Azure Table Storage
                    var entGen = Client.TableUtilities.entityGenerator;
                    var entity = {
                        PartitionKey: entGen.String(entityClass.partitionKey),
                        RowKey: entGen.String(entityClass.rowKey),
                        data: entGen.String(JSON.stringify(entityClass.data)),
                    };

                    clientTableService.insertEntity(entityClass.tableName, entity, function (err, result, response) {
                        node.log('trying to insert');
                        if (err) {
                            node.error('Error while trying to save data:' + err.toString());
                            
                            let newMsg = {};
                            newMsg.payload = entityClass.partitionKey;
                            newMsg.status = "Error";
                            newMsg.message = err.toString();

                            node.send(newMsg);
                            setStatus(statusEnum.error);

                        } else {
                            node.log(entityClass.partitionKey + ' saved.');

                            let newMsg = {};
                            newMsg.payload = entityClass.partitionKey;
                            newMsg.status = "OK";                           

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
                    node.error('Error while trying to read data:' + err.toString());
                    
                    let newMsg = {};
                    newMsg.payload = entityClass.partitionKey;
                    newMsg.status = "Error";
                    newMsg.message = err.toString();
                    node.send(newMsg);

                    setStatus(statusEnum.error);
                } else {
                    node.log(result.data._);
                    
                    let newMsg = {};
                    newMsg.payload = result.data._;
                    newMsg.status = "OK";
                    newMsg.partitionKey = entityClass.partitionKey;

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
                    node.log('table ' + table +' deleted');
                    setStatus(statusEnum.sent);
                    node.send('table deleted');
                }
            });
        }

        const updateEntity = (entityClass) => {
            node.log('updating entity');

            let entity = {
                PartitionKey: entGen.String(entityClass.partitionKey),
                RowKey: entGen.String(entityClass.rowKey),
                data: entGen.String(entityClass.data),
            };

            clientTableService.insertOrReplaceEntity(entityClass.tableName, entity, function (err, result, response) {
                if (err) {
                    node.error('Error while trying to update entity:' + err.toString());
                    setStatus(statusEnum.error);
                } else {
                    node.log('entity updated');
                    setStatus(statusEnum.sent);
                    node.send('entity updated');
                }
            });
        }

        const deleteEntity = (entityClass) => {
            node.log('deleting entity');

            let entity = {
                PartitionKey: entGen.String(entityClass.partitionKey),
                RowKey: entGen.String(entityClass.rowKey),
                data: entGen.String(entityClass.data),
            };

            clientTableService.deleteEntity(entityClass.tableName, entity, function (err, result, response) {
                if (err) {
                    node.error('Error while trying to delete entity:' + err.toString());
                    setStatus(statusEnum.error);
                } else {
                    node.log('entity deleted');
                    setStatus(statusEnum.sent);
                    node.send('entity deleted');
                }
            });
        }


        var queryEntity = function (table, fromcolumn, where, selectdata) {
            node.log('query entity');
            var query = new Client.TableQuery()
                .top(1)
                .where(entityClass.fromcolumn + ' eq ?', entityClass.where);
            clientTableService.queryEntities(entityClass.tableName, query, null, function (err, result, response) {
                if (err) {
                    node.error('Error while trying to query entity:' + err.toString());
                    setStatus(statusEnum.error);
                } else {
                    //node.log(JSON.stringify(result.entries.data));
                    //setStatus(statusEnum.sent);
                    //node.send(result.entries.data._);
                }
            });
        }

        var disconnectFrom = () => {
            if (clientTableService) {
                node.log('Disconnecting from Azure');
                clientTableService.removeAllListeners();
                clientTableService = null;
                setStatus(statusEnum.disconnected);
            }
        }       

        this.on('input', function (msg) {
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
                    //node.log('Trying to query data');
                    //queryEntity(messageJSON.tableName, messageJSON.fromColumn, messageJSON.where, messageJSON.selectData);
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

        this.on('close', function () {
            disconnectFrom(this);
        });
    }

    // Registration of the node into Node-RED
    RED.nodes.registerType("Aleph Table Storage", AzureTableStorage, {
        credentials: {
            accountname: { type: "text" },
            key: { type: "text" },
        },
        defaults: {
            name: { value: "Azure Table Storage" },
        }
    });    
}