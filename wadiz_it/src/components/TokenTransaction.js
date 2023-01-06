import React, { useEffect, useRef, useState } from "react";
import { Container, Grid, Header, Segment } from "semantic-ui-react";
import TokenOrderForm from "./TokenOrderForm";
import TokenOrderBook from "./TokenOrderBook";
import TokenOpenOrderList from "./TokenOpenOrderList";
import SockJS from "sockjs-client";
import * as StompJs from "@stomp/stompjs";

const TokenTransaction = () => {
  const [data, setData] = useState({
    memberNum: Number(sessionStorage.getItem("memberNum")),
    // memberNum: 1,
    tokenNum: 1,
    // tokenNum: 1,
    currentPrice: 0,
    listingPrice: 0,
    maxPrice: 1,
    minPrice: 0,
    availablePoint: 0,
    availableToken: 0,
    orderList: [],
    myOrderList: [],
  });

  const client = useRef({});
  useEffect(() => {
    connect();

    return () => disconnect();
  }, []);

  const connect = () => {
    client.current = new StompJs.Client({
      webSocketFactory: () => new SockJS("http://localhost:9999/webSocket"),
      debug: function (str) {
        console.log(str);
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        subscribe();
        initReq();
      },
      onStompError: (frame) => {
        console.error(frame);
      },
    });

    client.current.activate();
  };

  const disconnect = () => {
    client.current.deactivate();
  };

  const initReq = () => {
    if (data.memberNum === null) {
      console.log("로그인 필요");
      return;
    }
    // 데이터 초기화 요청
    const newMessage = { memberNum: data.memberNum, tokenNum: data.tokenNum };
    client.current.publish({
      destination: "/token/init/" + data.memberNum,
      body: JSON.stringify(newMessage),
    });
  };

  const initCallback = (body) => {
    const initData = JSON.parse(body);
    console.log(body);
    if (initData.retCode !== 200) {
      console.log(initData.errorMsg);
      return;
    }
    const dataObj = {
      ...data,
      tokenNum: initData.token.tokenNum,
      currentPrice: initData.token.currentPrice,
      listingPrice: initData.token.listingPrice,
      availablePoint: initData.member.point,
      availableToken: initData.availableToken,
      orderList: initData.tokenOrderList,
      myOrderList: initData.myOrderList,
    };
    setData(dataObj);
  };

  const orderCallBack = (body) => {
    console.log("order callback", body);
    const res = JSON.parse(body);
    if (res.retCode !== 200) {
      console.log(res.errorMsg);
      return;
    }
    console.log("order res", res);

    // 저장할 데이터 처리
    setData((prev) => {
      let newData = { ...prev };
      // 주문 타입에 따른 주문 얻기
      const newOrder = res.sellOrder === null ? res.buyOrder : res.sellOrder;

      console.log("neworder", newOrder);

      // 체결된 경우
      if (res.orderTransaction !== null) {
        // 주문 리스트에서 해당하는 매수/매도 주문 삭제
        const newOrderList = prev.orderList.filter(
          (order) =>
            order.orderNum !== res.orderTransaction.buyTokenOrderNum &&
            order.orderNum !== res.orderTransaction.sellTokenOrderNum
        );
        newData = {
          ...newData,
          orderList: newOrderList,
        };
      }
      // 체결되지 않은 경우
      else {
        // 주문 리스트에 주문 추가
        newData = {
          ...newData,
          orderList: [...prev.orderList, newOrder],
        };
      }
      console.log(prev.memberNum, res.ordererMemberNum);

      // 내 주문 리스트 업데이트
      console.log("myorder!", res.sellOrder);
      if (
        prev.memberNum === res.buyerMemberNum ||
        prev.memberNum === res.sellerMemberNum
      ) {
        // 체결되지 않은 경우: 내 주문 리스트에 주문 추가
        if (res.orderTransaction === null) {
          newData = {
            ...newData,
            myOrderList: [...prev.myOrderList, newOrder],
          };
        }
        // 체결된 경우: 내 주문 리스트에서 해당하는 주문 삭제
        else {
          const newOrderList = prev.myOrderList.filter(
            (order) =>
              order.orderNum !== res.orderTransaction.buyTokenOrderNum &&
              order.orderNum !== res.orderTransaction.sellTokenOrderNum
          );
          newData = {
            ...newData,
            myOrderList: [...newOrderList],
          };
        }
      }
      // 내 주문이 처리된 경우의 보유 포인트 및 토큰 업데이트
      if (prev.memberNum === res.buyerMemberNum) {
        newData = {
          ...newData,
          availableToken: res.buyerTokenAmount,
          availablePoint: res.buyerPoint,
        };
      } else if (prev.memberNum === res.sellerMemberNum) {
        newData = {
          ...newData,
          availableToken: res.sellerTokenAmount,
          availablePoint: res.sellerPoint,
        };
      }

      console.log("prev", prev);
      console.log("sum", { ...prev, ...newData });
      return { ...prev, ...newData };
    });
  };

  const cancelCallBack = (body) => {
    const res = JSON.parse(body);
    if (res.retCode !== 200) {
      console.log(res.errorMsg);
      return;
    }
    console.log("cancel res", res);

    // 저장할 데이터 처리
    setData((prev) => {
      let newData = { ...prev };

      // 내가 주문한 경우의 보유 포인트 및 토큰 업데이트
      if (prev.memberNum === res.buyerMemberNum) {
        console.log("myorder!", res.cancelOrder);
        // 포인트 및 보유 토큰 업데이트
        newData = {
          ...newData,
          availableToken: res.buyerTokenAmount,
          availablePoint: res.buyerPoint,
        };
        //내 주문 리스트에 주문에서 해당하는 주문 삭제
        const newOrderList = prev.myOrderList.filter(
          (order) => order.orderNum !== res.cancelOrder.orderNum
        );
        newData = {
          ...newData,
          myOrderList: [...newOrderList],
        };
      }

      // 주문 리스트에서 삭제
      const newOrderList = prev.orderList.filter(
        (order) => order.orderNum !== res.cancelOrder.orderNum
      );
      newData = {
        ...newData,
        orderList: [...newOrderList],
      };

      console.log("prev", prev);
      console.log("sum", { ...prev, ...newData });
      return { ...prev, ...newData };
    });
  };

  const subscribe = () => {
    // 초기화 요청에 대한 응답 구독
    client.current.subscribe("/queue/init-" + data.memberNum, ({ body }) =>
      initCallback(body)
    );

    // 주문 요청에 대한 응답 구독
    client.current.subscribe("/topic/order/" + data.tokenNum, ({ body }) => {
      orderCallBack(body);
    });

    // 주문 취소 요청에 대한 응답 구독
    client.current.subscribe("/topic/cancel/" + data.tokenNum, ({ body }) => {
      cancelCallBack(body);
    });
  };

  // 매수 주문 버튼 클릭
  const btnBuyOrder = (price, amount) => {
    console.log(data.availableToken);
    const newOrder = {
      type: 1,
      price: price,
      amount: amount,
    };
    console.log("buy", JSON.stringify(newOrder));
    client.current.publish({
      destination: "/token/order/" + data.tokenNum,
      body: JSON.stringify(newOrder),
    });
  };

  // 매도 주문 버튼 클릭
  const btnSellOrder = (price, amount) => {
    console.log(data.availableToken);
    const newOrder = {
      type: 2,
      price: price,
      amount: amount,
    };
    console.log("sell", JSON.stringify(newOrder));
    client.current.publish({
      destination: "/token/order/" + data.tokenNum,
      body: JSON.stringify(newOrder),
    });
  };

  // 주문 취소 버튼 클릭
  const btnCancelOrder = (orderNum) => {
    const newOrder = {
      tokenOrderNum: orderNum,
      type: 3,
    };
    console.log("cancel", JSON.stringify(newOrder));
    client.current.publish({
      destination: "/token/cancel/" + data.tokenNum,
      body: JSON.stringify(newOrder),
    });
  };

  return (
    <Container textAlign="left">
      <Header as={"h2"}>후원 토큰 거래소</Header>
      <Grid stackable centered style={{ margin: 0, padding: 0 }}>
        <Grid.Row style={{ margin: 0, padding: 0 }}>
          <Grid.Column
            textAlign="left"
            verticalAlign={"middle"}
            stretched
            style={{ margin: 0, padding: 0 }}
            width={16}
          >
            <Segment
              style={{ margin: 0, padding: 0, paddingBottom: 0 }}
              basic={true}
            >
              {/* <Header
                style={{ margin: 0, padding: 0, paddingLeft: 10 }}
                as={"h5"}
              >
                시작가:{data.listingPrice} 현재가:{data.currentPrice}원 최저가:
                {data.minPrice}원 최고가:{data.maxPrice}원
              </Header> */}
            </Segment>
          </Grid.Column>
        </Grid.Row>

        <Grid.Row style={{ margin: 0, padding: 0, maxHeight: 440 }}>
          <Grid.Column
            verticalAlign={"middle"}
            stretched
            style={{
              margin: 0,
              padding: 0,
              maxHeight: 440,
            }}
            width={5}
          >
            <TokenOrderBook orderList={data.orderList}></TokenOrderBook>
          </Grid.Column>
          <Grid.Column
            textAlign="left"
            verticalAlign={"middle"}
            stretched
            style={{
              margin: 0,
              padding: 0,
              maxHeight: 440,
            }}
            width={6}
          >
            <Container>
              <TokenOrderForm
                availablePoint={data.availablePoint}
                availableToken={data.availableToken}
                sendBuyOrder={btnBuyOrder}
                sendSellOrder={btnSellOrder}
              ></TokenOrderForm>
            </Container>
          </Grid.Column>
          <Grid.Column
            verticalAlign={"top"}
            stretched
            style={{
              margin: 0,
              padding: 0,
              paddingLeft: 10,
              maxHeight: 440,
              overflow: "auto",
            }}
            width={5}
          >
            <TokenOpenOrderList
              myOrderList={data.myOrderList}
              cancel={btnCancelOrder}
            ></TokenOpenOrderList>
          </Grid.Column>
        </Grid.Row>
      </Grid>

      <Container
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      ></Container>
    </Container>
  );
};

export default TokenTransaction;
