const API = {

    async getOrders(){

        const response = await fetch("/orders");

        const data = await response.json();

        return data.result.list;

    },

    async getOrder(code){

        const response = await fetch("/order/" + code);

        return await response.json();

    }

};